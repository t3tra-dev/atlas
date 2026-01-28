import type { BasePlugin } from "@/plugin";

import { builtinCommands, builtinKeybindings } from "./commands";
import {
  builtinAddMenu,
  builtinEditMenu,
  builtinFileMenu,
  builtinViewMenu,
} from "./menus";
import { builtinNodes } from "./nodes";

export const BuiltinPlugin: BasePlugin = {
  id: "builtin",
  register: (ctx) => {
    const nodes = builtinNodes();
    return {
      nodes,
      menus: {
        add: builtinAddMenu(nodes),
        file: builtinFileMenu(),
        edit: builtinEditMenu(),
        view: builtinViewMenu(),
      },
      commands: builtinCommands(ctx, nodes),
      keybindings: builtinKeybindings(),
    };
  },
};
