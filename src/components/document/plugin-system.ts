import type { NodeTypeDefinition } from "@/components/document/sdk";
import type {
  BasePlugin,
  CommandContribution,
  KeybindingContribution,
  MenuEntry,
  PluginContext,
} from "@/plugin";

export interface NodeRegistry {
  get: (type: string) => NodeTypeDefinition | undefined;
  list: () => Array<NodeTypeDefinition>;
}

export interface PluginHost {
  nodeRegistry: NodeRegistry;
  menus: {
    add: Array<MenuEntry>;
    file: Array<MenuEntry>;
    edit: Array<MenuEntry>;
    view: Array<MenuEntry>;
  };

  commands: {
    get: (id: string) => CommandContribution | undefined;
    execute: (id: string) => void;
    list: () => Array<CommandContribution>;
  };

  keybindings: Array<KeybindingContribution>;
}

export function createPluginHost(
  plugins: Array<BasePlugin>,
  ctx: PluginContext,
): PluginHost {
  const nodeMap = new Map<string, NodeTypeDefinition>();
  const addMenu: Array<MenuEntry> = [];
  const fileMenu: Array<MenuEntry> = [];
  const editMenu: Array<MenuEntry> = [];
  const viewMenu: Array<MenuEntry> = [];
  const commandMap = new Map<string, CommandContribution>();
  const keybindings: Array<KeybindingContribution> = [];

  for (const plugin of plugins) {
    const c = plugin.register(ctx);
    for (const nodeDef of c.nodes ?? []) {
      if (nodeMap.has(nodeDef.type)) {
        throw new Error(
          `Duplicate node type '${nodeDef.type}' registered by '${plugin.id}'.`,
        );
      }
      nodeMap.set(nodeDef.type, nodeDef);
    }

    for (const entry of c.menus?.file ?? []) {
      fileMenu.push(entry);
    }

    for (const entry of c.menus?.add ?? []) {
      addMenu.push(entry);
    }

    for (const entry of c.menus?.edit ?? []) {
      editMenu.push(entry);
    }

    for (const entry of c.menus?.view ?? []) {
      viewMenu.push(entry);
    }

    for (const cmd of c.commands ?? []) {
      if (commandMap.has(cmd.id)) {
        throw new Error(
          `Duplicate command '${cmd.id}' registered by '${plugin.id}'.`,
        );
      }
      commandMap.set(cmd.id, cmd);
    }

    for (const kb of c.keybindings ?? []) {
      keybindings.push(kb);
    }
  }

  return {
    nodeRegistry: {
      get: (type) => nodeMap.get(type),
      list: () => Array.from(nodeMap.values()),
    },
    menus: {
      add: addMenu,
      file: fileMenu,
      edit: editMenu,
      view: viewMenu,
    },
    commands: {
      get: (id) => commandMap.get(id),
      execute: (id) => {
        const cmd = commandMap.get(id);
        if (!cmd) return;
        void cmd.run();
      },
      list: () => Array.from(commandMap.values()),
    },
    keybindings,
  };
}
