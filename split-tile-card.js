/*
 * Split Tile Card: a Home Assistant dashboard tile split in two. Tapping the tile turns
 * its entities on or off; the button on the right (or a long press) opens more. With
 * swap: true the halves trade: tap opens, and a power button on the right toggles.
 *
 * Three kinds of tile, chosen by what the right-hand button opens:
 *
 *   Room tile (navigation_path set): opens a dashboard view; lights come on at 100%.
 *
 *     type: custom:split-tile-card
 *     name: Kitchen
 *     entity: light.kitchen_lights          # or entities: [light.a, light.b]
 *     navigation_path: /lovelace/kitchen
 *
 *   Light tile (neither set): opens the more-info dialog of the first entity, where the
 *   brightness slider is; the light comes back at its last brightness.
 *
 *     type: custom:split-tile-card
 *     entity: light.desk_lamp
 *
 *   Pop-up tile (popup set): opens a pop-up holding any other cards.
 *
 *     type: custom:split-tile-card
 *     name: Notifications
 *     entities: [switch.a, switch.b]        # tap: all off if any is on, else all on
 *     popup:
 *       title: Notifications                # default: the tile's name
 *       cards: [{...}, {...}]
 *
 * Optional:
 *   brightness_pct: 100     # brightness when turning lights on (room tiles default to 100,
 *                           # others to the last level; null on a room tile means the last level)
 *   swap: true              # tap opens and a power button toggles (default false)
 *   tap_action: {...}       # replaces the toggle
 *   hold_action: {...}      # replaces the long press (default: what the right button does)
 *   indicator: icon         # what shows the state (default icon):
 *                           #   icon: the icon in a circle, coloured when on, like the tile card
 *                           #   bar:  a bar down the left edge; icons stay grey and are optional
 *   icon: mdi:sofa          # the icon; default the first entity's own, which follows its state
 *   show_icon: true         # with indicator: bar, show the icon (default only if icon is set)
 *   on_color: amber         # colour when on: a theme colour name or any CSS colour (default
 *                           # the theme's active colour for the first entity's domain)
 *
 * Entities can be lights, switches, fans, input booleans or groups of them. A tile counts as
 * on when any of its entities is "on"; groups are expanded for the "2 of 3 on" count.
 */

const VERSION = "1.1.1";
const TYPE = "split-tile-card";
const HOLD_MS = 500;
const MOVE_PX = 10; // a pointer that moves further than this is a drag, not a tap
const DOMAINS = ["light", "switch", "fan", "input_boolean", "group"];
const STRINGS = {
  count: (lit, all) => `${lit} of ${all} on`,
  open: "Open",
  openView: "Open view",
  details: "Details",
  turnOn: "Turn on",
  turnOff: "Turn off",
  close: "Close",
};
// events that cards inside the pop-up fire, passed on from this card so Home Assistant sees them
const FORWARDED = ["hass-action", "hass-more-info", "ll-custom", "show-dialog", "hass-notification"];

function entityIds(config) {
  const list = config.entities != null ? [].concat(config.entities) : [config.entity];
  return list.map((e) => (e && typeof e === "object" ? e.entity : e));
}

class SplitTileCard extends HTMLElement {
  setConfig(config) {
    if (!config || (config.entity == null && config.entities == null)) {
      throw new Error(`${TYPE}: set entity or entities`);
    }
    const entities = entityIds(config);
    if (!entities.length || entities.some((id) => typeof id !== "string" || !id.includes("."))) {
      throw new Error(`${TYPE}: every entity must be an entity id, such as light.kitchen`);
    }
    if (config.popup != null) {
      if (typeof config.popup !== "object" || !Array.isArray(config.popup.cards || [])) {
        throw new Error(`${TYPE}: popup.cards must be a list of cards`);
      }
    }
    this._closePopup();
    this._config = {
      brightness_pct: config.navigation_path ? 100 : null,
      swap: false,
      ...config,
      indicator: config.indicator === "bar" ? "bar" : "icon",
      entities,
    };
    this._built = false;
    this._seen = null;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._popupCards) for (const el of this._popupCards) el.hass = hass;
    if (this._changed()) this._render();
  }

  disconnectedCallback() {
    this._cancelHold && this._cancelHold();
    this._closePopup();
  }

  getCardSize() {
    return 1;
  }

  getGridOptions() {
    return { columns: 6, rows: 1, min_columns: 3, min_rows: 1 };
  }

  static getConfigElement() {
    return document.createElement(`${TYPE}-editor`);
  }

  static getStubConfig(hass) {
    const ids = Object.keys(hass.states);
    const entity =
      ids.find((e) => e.startsWith("light.")) ||
      ids.find((e) => DOMAINS.includes(e.split(".")[0])) ||
      "light.example";
    return { entity };
  }

  // Every entity behind the configured ones (groups are expanded), for "2 of 3 on".
  _members() {
    const out = [];
    for (const id of this._config.entities) {
      const st = this._hass.states[id];
      const kids = st && st.attributes && st.attributes.entity_id;
      if (Array.isArray(kids) && kids.length) out.push(...kids);
      else out.push(id);
    }
    return out.map((id) => this._hass.states[id]).filter(Boolean);
  }

  // Re-render only when a watched entity's state object changed, not on every state change
  // in the house.
  _changed() {
    if (!this._config || !this._hass) return false;
    const ids = [...this._config.entities];
    for (const id of this._config.entities) {
      const kids = this._hass.states[id]?.attributes?.entity_id;
      if (Array.isArray(kids)) ids.push(...kids);
    }
    const now = ids.map((id) => this._hass.states[id]);
    const same =
      this._seen && this._seen.length === now.length && now.every((s, i) => s === this._seen[i]);
    this._seen = now;
    return !same || !this._built;
  }

  _anyOn() {
    return this._config.entities.some((id) => this._hass.states[id]?.state === "on");
  }

  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { display: block; height: 100%; }
        ha-card {
          height: 100%;
          min-height: 56px;
          box-sizing: border-box;
          display: flex;
          align-items: stretch;
          overflow: hidden;
          --on: var(--split-tile-on-color, var(--split-tile-domain-color, #ffc107));
        }
        .main, .go {
          cursor: pointer;
          user-select: none;
          -webkit-user-select: none;
          -webkit-touch-callout: none;
          -webkit-tap-highlight-color: transparent;
          outline: none;
        }
        .main {
          flex: 1;
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 10px;
          padding-inline: 10px 4px;
        }
        .bar {
          align-self: stretch;
          width: 5px;
          margin: 8px 0;
          border-radius: 3px;
          flex: none;
          background: var(--primary-text-color);
          opacity: 0.25;
          transition: background 0.2s, opacity 0.2s;
        }
        :host([state="off"]) .bar { opacity: 0.8; }
        :host([state="on"]) .bar { background: var(--on); opacity: 1; }
        .icon {
          flex: none;
          --mdc-icon-size: 24px;
          color: var(--secondary-text-color);
        }
        /* indicator: icon -- no bar; the icon sits in a circle and takes the colour when on */
        :host([indicator="icon"]) .bar { display: none; }
        :host([indicator="icon"]) .main { padding-inline-start: 8px; }
        :host([indicator="icon"]) .icon {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          --mdc-icon-size: 22px;
          color: var(--state-inactive-color, var(--secondary-text-color));
          background: rgba(127, 127, 127, 0.15);
          transition: color 0.2s, background 0.2s;
        }
        :host([indicator="icon"][state="on"]) .icon {
          color: var(--on);
          background: color-mix(in srgb, var(--on) 20%, transparent);
        }
        :host([indicator="icon"][state="unknown"]) .icon { opacity: 0.5; }
        .text { min-width: 0; display: flex; flex-direction: column; }
        .name, .info {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .name {
          font-size: var(--ha-font-size-m, 14px);
          font-weight: var(--ha-font-weight-medium, 500);
          color: var(--primary-text-color);
          line-height: 20px;
        }
        .info {
          font-size: var(--ha-font-size-s, 12px);
          color: var(--secondary-text-color);
          line-height: 16px;
        }
        .go {
          flex: none;
          width: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          color: var(--secondary-text-color);
        }
        .go::before {
          content: "";
          position: absolute;
          inset-inline-start: 0;
          top: 22%;
          bottom: 22%;
          width: 1px;
          background: var(--divider-color, rgba(127, 127, 127, 0.3));
        }
        :host(:dir(rtl)) .go.chevron ha-icon { transform: scaleX(-1); }
        .main:hover, .go:hover { background: rgba(127, 127, 127, 0.08); }
        .main:active, .go:active { background: rgba(127, 127, 127, 0.16); }
        .main:focus-visible, .go:focus-visible {
          box-shadow: inset 0 0 0 2px var(--primary-color);
        }
      </style>
      <ha-card>
        <div class="main" role="button" tabindex="0">
          <div class="bar"></div>
          <ha-state-icon class="icon"></ha-state-icon>
          <div class="text">
            <span class="name"></span>
            <span class="info"></span>
          </div>
        </div>
        <div class="go" role="button" tabindex="0">
          <ha-icon></ha-icon>
        </div>
      </ha-card>`;

    const main = root.querySelector(".main");
    const go = root.querySelector(".go");
    this._els = {
      main,
      go,
      goIcon: go.querySelector("ha-icon"),
      icon: root.querySelector(".icon"),
      name: root.querySelector(".name"),
      info: root.querySelector(".info"),
      card: root.querySelector("ha-card"),
    };

    // tap vs hold vs drag on the main part
    let timer = null;
    let held = false;
    let start = null;
    const cancel = () => {
      clearTimeout(timer);
      timer = null;
    };
    this._cancelHold = cancel;
    main.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      cancel(); // a second finger starts over rather than leaving a stray timer
      held = false;
      start = { x: ev.clientX, y: ev.clientY };
      timer = setTimeout(() => {
        timer = null;
        if (!this.isConnected) return;
        held = true;
        this._hold();
      }, HOLD_MS);
    });
    main.addEventListener("pointermove", (ev) => {
      if (timer && start && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > MOVE_PX)
        cancel();
    });
    main.addEventListener("pointerup", () => {
      if (timer) {
        cancel();
        this._mainTap();
      }
    });
    main.addEventListener("pointerleave", cancel);
    main.addEventListener("pointercancel", cancel);
    main.addEventListener("contextmenu", (ev) => {
      if (held || timer) ev.preventDefault();
    });
    const keys = (el, fn) =>
      el.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        if (!ev.repeat) fn();
      });
    keys(main, () => this._mainTap());
    go.addEventListener("click", () => this._sideTap());
    keys(go, () => this._sideTap());

    this._built = true;
  }

  _render() {
    if (!this._config || !this._hass) return;
    if (!this._built) this._build();
    const c = this._config;
    const e = this._els;
    const hass = this._hass;

    const first = hass.states[c.entities[0]];
    const known = c.entities.some((id) => {
      const st = hass.states[id];
      return st && st.state !== "unavailable" && st.state !== "unknown";
    });
    const on = this._anyOn();
    this.setAttribute("state", !known ? "unknown" : on ? "on" : "off");
    this.setAttribute("indicator", c.indicator);
    // the theme's active colour for the first entity's domain, as the tile card uses
    const domain = c.entities[0].split(".")[0];
    e.card.style.setProperty(
      "--split-tile-domain-color",
      `var(--state-${domain}-active-color, var(--state-active-color, #ffc107))`
    );
    if (c.on_color)
      e.card.style.setProperty(
        "--split-tile-on-color",
        /^[a-z-]+$/.test(c.on_color) ? `var(--${c.on_color}-color, ${c.on_color})` : c.on_color
      );
    else e.card.style.removeProperty("--split-tile-on-color");

    e.name.textContent = c.name || (first && first.attributes.friendly_name) || c.entities[0];
    // a set icon, or the entity's own (ha-state-icon follows its state). With the icon as the
    // indicator it always shows; with the bar it is grey and shows only when asked for.
    const showIcon = c.indicator === "icon" || !!(c.icon || c.show_icon);
    e.icon.style.display = showIcon ? "" : "none";
    if (showIcon) {
      e.icon.hass = hass;
      e.icon.stateObj = first;
      e.icon.icon = c.icon || undefined;
    }

    // the right-hand button: a chevron that opens, or with swap a power button that toggles
    const opens = c.popup ? STRINGS.open : c.navigation_path ? STRINGS.openView : STRINGS.details;
    const toggles = on ? STRINGS.turnOff : STRINGS.turnOn;
    e.goIcon.setAttribute("icon", c.swap ? "mdi:power" : "mdi:chevron-right");
    e.go.classList.toggle("chevron", !c.swap);
    e.go.setAttribute("aria-label", c.swap ? toggles : opens);
    e.main.setAttribute("aria-label", `${e.name.textContent}: ${c.swap ? opens : toggles}`);

    const fmt = (st) => (hass.formatEntityState ? hass.formatEntityState(st) : st.state);
    let info;
    if (!known) {
      info = first ? fmt(first) : hass.localize?.("state.default.unavailable") || "Unavailable";
    } else if (c.navigation_path || c.entities.length > 1) {
      // several entities: always "x of y on", even when none are
      const members = this._members();
      info = STRINGS.count(members.filter((s) => s.state === "on").length, members.length);
    } else if (on && first.attributes.brightness != null) {
      info = `${Math.round((first.attributes.brightness / 255) * 100)}%`;
    } else {
      info = fmt(first);
    }
    e.info.textContent = info;
  }

  _fireAction(action) {
    this.dispatchEvent(
      new CustomEvent("hass-action", {
        bubbles: true,
        composed: true,
        detail: {
          config: { entity: this._config.entities[0], tap_action: action },
          action: "tap",
        },
      })
    );
  }

  _toggle() {
    const c = this._config;
    if (c.tap_action) return this._fireAction(c.tap_action);
    const ids = c.entities;
    if (this._anyOn()) {
      this._hass.callService("homeassistant", "turn_off", { entity_id: ids });
      return;
    }
    const lights = ids.filter((id) => id.startsWith("light."));
    const other = ids.filter((id) => !id.startsWith("light."));
    if (lights.length)
      this._hass.callService("light", "turn_on", {
        entity_id: lights,
        ...(c.brightness_pct != null ? { brightness_pct: c.brightness_pct } : {}),
      });
    if (other.length) this._hass.callService("homeassistant", "turn_on", { entity_id: other });
  }

  _mainTap() {
    if (this._config.swap) this._open();
    else this._toggle();
  }

  _sideTap() {
    if (this._config.swap) this._toggle();
    else this._open();
  }

  // a long press on the main part does what the right-hand button does
  _hold() {
    const c = this._config;
    if (navigator.vibrate) navigator.vibrate(30);
    if (c.hold_action) return this._fireAction(c.hold_action);
    this._sideTap();
  }

  // the pop-up, the view, or the first entity's more-info dialog
  _open() {
    if (this._config.popup) return this._openPopup();
    const path = this._config.navigation_path;
    if (path) this._fireAction({ action: "navigate", navigation_path: path });
    else this._fireAction({ action: "more-info" });
  }

  // The pop-up lives on document.body so no dashboard layout can clip or cover it; the events
  // its cards fire are passed on from this card, where Home Assistant handles them.
  async _openPopup() {
    if (this._popup || this._opening) return;
    this._opening = true;
    let helpers;
    try {
      helpers = await window.loadCardHelpers();
    } finally {
      this._opening = false;
    }
    if (!this.isConnected || this._popup) return;
    const p = this._config.popup;

    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        .backdrop {
          position: fixed;
          inset: 0;
          z-index: 9;
          background: rgba(0, 0, 0, 0.55);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          box-sizing: border-box;
        }
        .dialog {
          width: min(420px, 100%);
          max-height: 100%;
          overflow: auto;
          box-sizing: border-box;
          padding: 16px;
          border-radius: var(--ha-card-border-radius, 12px);
          background: var(--ha-card-background, var(--card-background-color, #1c1c1c));
          color: var(--primary-text-color);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        }
        .head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
        }
        .title {
          font-size: var(--ha-font-size-l, 16px);
          font-weight: var(--ha-font-weight-medium, 500);
        }
        .close {
          border: 0;
          background: none;
          color: var(--secondary-text-color);
          cursor: pointer;
          padding: 4px;
          border-radius: 50%;
          display: flex;
        }
        .close:hover { background: rgba(127, 127, 127, 0.15); }
        .close:focus-visible { outline: 2px solid var(--primary-color); }
        .cards { display: flex; flex-direction: column; gap: 8px; }
      </style>
      <div class="backdrop">
        <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="title">
          <div class="head">
            <span class="title" id="title"></span>
            <button class="close"><ha-icon icon="mdi:close"></ha-icon></button>
          </div>
          <div class="cards"></div>
        </div>
      </div>`;
    root.querySelector(".title").textContent = p.title || this._config.name || "";
    const closeBtn = root.querySelector(".close");
    closeBtn.setAttribute("aria-label", STRINGS.close);
    closeBtn.title = STRINGS.close;

    const list = root.querySelector(".cards");
    const make = (cfg) => {
      const el = helpers.createCardElement(cfg);
      el.hass = this._hass;
      // a custom card that wasn't defined yet asks to be rebuilt once it is
      el.addEventListener("ll-rebuild", (ev) => {
        ev.stopPropagation();
        const fresh = make(cfg);
        el.replaceWith(fresh);
        this._popupCards = this._popupCards.map((x) => (x === el ? fresh : x));
      });
      return el;
    };
    this._popupCards = (p.cards || []).map((cfg) => list.appendChild(make(cfg)));

    const close = () => this._closePopup();
    root.querySelector(".backdrop").addEventListener("click", (ev) => {
      if (ev.target === ev.currentTarget) close();
    });
    closeBtn.addEventListener("click", close);
    // Esc while focus is in the pop-up; a dialog opened above it keeps its own Esc
    root.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        close();
      }
    });

    for (const type of FORWARDED) {
      host.addEventListener(type, (ev) => {
        ev.stopPropagation();
        this.dispatchEvent(new CustomEvent(type, { detail: ev.detail, bubbles: true, composed: true }));
      });
    }

    this._returnFocus = this.shadowRoot.activeElement;
    document.body.appendChild(host);
    this._popup = host;
    closeBtn.focus();
  }

  _closePopup() {
    if (!this._popup) return;
    this._popup.remove();
    this._popup = null;
    this._popupCards = null;
    if (this._returnFocus && this.isConnected) this._returnFocus.focus();
    this._returnFocus = null;
  }
}

// The visual editor: Home Assistant's own form (ha-form) over the options above. A pop-up's
// cards stay in the code editor; only its title is here, and only on a pop-up tile.
class SplitTileCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  _schema() {
    const bar = this._config.indicator === "bar";
    const schema = [
      { name: "name", selector: { text: {} } },
      {
        name: "entities",
        required: true,
        selector: { entity: { multiple: true, filter: { domain: DOMAINS } } },
      },
      { name: "navigation_path", selector: { navigation: {} } },
      {
        type: "grid",
        name: "",
        schema: [
          {
            name: "indicator",
            selector: {
              select: {
                mode: "dropdown",
                options: [
                  { value: "icon", label: "Icon" },
                  { value: "bar", label: "Bar down the left edge" },
                ],
              },
            },
          },
          { name: "on_color", selector: { ui_color: {} } },
          { name: "icon", selector: { icon: {} } },
          ...(bar ? [{ name: "show_icon", selector: { boolean: {} } }] : []),
          {
            name: "brightness_pct",
            selector: { number: { min: 1, max: 100, mode: "box", unit_of_measurement: "%" } },
          },
          { name: "swap", selector: { boolean: {} } },
        ],
      },
    ];
    if (this._config.popup)
      schema.push({
        type: "expandable",
        name: "popup",
        title: "Pop-up",
        schema: [{ name: "title", selector: { text: {} } }],
      });
    schema.push({
      type: "expandable",
      name: "",
      title: "Actions",
      flatten: true,
      schema: [
        { name: "tap_action", selector: { ui_action: {} } },
        { name: "hold_action", selector: { ui_action: {} } },
      ],
    });
    return schema;
  }

  _label(s) {
    const view = !!this._config.navigation_path;
    return (
      {
        name: "Name",
        entities: "Entities",
        navigation_path: "View to open (makes it a room tile)",
        icon: "Icon (default: the entity's)",
        show_icon: "Show the icon",
        indicator: "State shown by",
        on_color: "Colour when on",
        brightness_pct: view ? "Turn-on brightness (default 100%)" : "Turn-on brightness (default: last)",
        swap: "Swap: tap opens, power button toggles",
        title: "Pop-up title (default: the name)",
        tap_action: "Tap action (replaces the toggle)",
        hold_action: "Hold action (default: what the right button does)",
      }[s.name] || s.name
    );
  }

  _render() {
    if (!this._config) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => this._label(s);
      this._form.addEventListener("value-changed", (ev) => this._changed(ev.detail.value));
      this.appendChild(this._form);
    }
    const c = this._config;
    this._form.hass = this._hass;
    this._form.schema = this._schema();
    // the form always edits a list; the card takes entity or entities
    this._form.data = {
      ...c,
      indicator: c.indicator === "bar" ? "bar" : "icon",
      entities: c.entity != null || c.entities != null ? entityIds(c) : [],
    };
  }

  _changed(value) {
    const before = this._config;
    const out = { ...value };
    const ents = (out.entities || []).filter(Boolean);
    delete out.entity;
    delete out.entities;
    // keep the key the config already used; a new card uses entity for one, entities for more
    if (ents.length === 1 && before.entities == null) out.entity = ents[0];
    else out.entities = ents;
    for (const k of Object.keys(out)) {
      if (out[k] === "" || out[k] === undefined || out[k] === null) delete out[k];
    }
    if (out.swap === false) delete out.swap;
    if (out.show_icon === false || out.indicator !== "bar") delete out.show_icon;
    if (out.indicator !== "bar") delete out.indicator; // icon is the default
    // brightness_pct: null on a room tile means "the last level"; the form can't show it
    if (before.brightness_pct === null && !("brightness_pct" in out)) out.brightness_pct = null;
    // keep the pop-up's cards, which the form doesn't show
    if (before.popup) {
      out.popup = { ...before.popup, ...(out.popup || {}) };
      if (!out.popup.title) delete out.popup.title;
    }
    // a fixed order for the main keys, the rest after
    const order = ["type", "name", "icon", "entity", "entities", "navigation_path"];
    const sorted = {};
    for (const k of order) if (k in out) sorted[k] = out[k];
    Object.assign(sorted, out);
    this._config = sorted;
    this.dispatchEvent(
      new CustomEvent("config-changed", { detail: { config: sorted }, bubbles: true, composed: true })
    );
  }
}

// a second copy (say, from HACS and from a leftover /local/ resource) must not throw
if (!customElements.get(TYPE)) {
  customElements.define(TYPE, SplitTileCard);
  customElements.define(`${TYPE}-editor`, SplitTileCardEditor);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: TYPE,
    name: "Split Tile Card",
    description:
      "A tile split in two: tap toggles the lights or switches, the chevron opens a view, the more-info dialog or a pop-up of cards.",
    preview: true,
    documentationURL: "https://github.com/Dynamic-Solutions-Canada/split-tile-card",
  });
  console.info(`%c SPLIT-TILE-CARD %c ${VERSION} `, "color:#fff;background:#03a9f4", "");
}
