import type { DocumentSDK, NodeTypeDef } from "@/components/document/sdk";

export interface PluginContext {
  sdk: DocumentSDK;
}

export type MenuItemVariant = "default" | "destructive";

export type MenuEntry =
  | {
    kind: "item";
    id?: string;
    label: string;
    shortcut?: string;
    variant?: MenuItemVariant;
    disabled?: boolean;
    /** Execute a command when selected (preferred). */
    command?: string;
    /** Legacy: direct handler (will be called if provided). */
    onSelect?: () => void;
  }
  | {
    kind: "submenu";
    id?: string;
    label: string;
    disabled?: boolean;
    entries: Array<MenuEntry>;
  }
  | {
    kind: "separator";
  };

export interface MenuContribution {
  add?: Array<MenuEntry>;
  file?: Array<MenuEntry>;
  edit?: Array<MenuEntry>;
  view?: Array<MenuEntry>;
}

export type CommandHandler = () => void | Promise<void>;

export interface CommandContribution {
  id: string;
  title?: string;
  run: CommandHandler;
}

/**
 * VSCode-like keybinding string.
 * Examples: "mod+s", "escape", "delete", "backspace", "shift+mod+z".
 */
export interface KeybindingContribution {
  keys: string;
  command: string;
  preventDefault?: boolean;
  /** Whether to allow triggering while typing in inputs/textarea/contenteditable. */
  allowInTextInput?: boolean;
}

export interface PluginContribution {
  nodes?: Array<NodeTypeDef>;
  menus?: MenuContribution;
  commands?: Array<CommandContribution>;
  keybindings?: Array<KeybindingContribution>;
}

export interface BasePlugin {
  id: string;

  /**
   * Register plugin features (node types, commands, etc.).
   * Keep it pure: avoid side effects; return contributions.
   */
  register: (ctx: PluginContext) => PluginContribution;
}

export type { DocumentSDK, NodeTypeDef };
