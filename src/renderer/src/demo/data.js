// Demo data from design prototype v12. Everything here is DEMO DATA and is
// shown with the DEMO DATA badge. Never mix it into real history (spec 17.6).

export const FILES=[
 {n:"Daily 2026-11-16.md",p:"Personal",s:"4 KB",i:true},
 {n:"Map-Ideen.md",p:"Roblox Game",s:"11 KB",i:true},
 {n:"GameLoop.luau",p:"Roblox Game",s:"23 KB",i:true},
 {n:"Monetization.md",p:"Roblox Game",s:"7 KB",i:true},
 {n:"Lobby.rbxl",p:"Roblox Game",s:"412 MB",i:false},
 {n:"NEURAL OS Spec.md",p:"NEURAL OS",s:"96 KB",i:true},
 {n:"Brain-Moodboard.png",p:"NEURAL OS",s:"2.1 MB",i:true}];

export const EVENTS=[
 {r:"memory",k:"Read",x:"Map-Ideen.md",f:1},
 {r:"planning",k:"TodoWrite",x:"3 tasks"},
 {r:"execution",k:"Edit",x:"GameLoop.luau",f:1},
 {r:"execution",k:"Bash",x:"rojo build -o Game.rbxl"},
 {r:"research",k:"WebSearch",x:"Luau task.spawn vs coroutine"},
 {r:"workflows",k:"Skill",x:"roblox-vfx"},
 {r:"connectors",k:"mcp",x:"GitHub · list_pull_requests"},
 {r:"subagents",k:"Agent",x:"Explore"},
 {r:"memory",k:"Read",x:"NEURAL OS Spec.md",f:1},
 {r:"execution",k:"Error",x:"rojo build · exit code 1",s:"Roblox Game"},
 {r:"execution",k:"Edit",x:"Monetization.md",f:1,s:"Roblox Game"},
 {r:"other",k:"Stop",x:"Roblox Game",s:"Roblox Game"}];

export const CONNECTORS=[{n:"GitHub",s:"ok",nv:"Development"},{n:"Obsidian Vault",s:"ok",nv:"Memory"},{n:"OBS Studio",s:"ok",nv:"Media"},{n:"Figma",s:"warn",nv:"Creative"},{n:"Blender",s:"bad",nv:"3D"}];

export const NOTE="# Map-Ideen\n\nLobby mit drei Portalen, siehe [[GameLoop]] und [[Monetization]].\n\n> [!note]\n> Spawn-Punkte nach jedem Update in [[Lobby.rbxl]] prüfen.\n\n#roblox #design\n";

export const FX=[
 {k:"note",ty:"md",st:"indexed",imp:"02.11.2026",mod:"16.11.2026",tags:["daily"],md:"# Daily 2026-11-16\n\n- [x] Lobby-Portale skizziert, siehe [[Map-Ideen]]\n- [ ] [[NEURAL OS Spec]] weiterlesen\n- GameLoop braucht einen Refactor\n\n#daily"},
 {k:"note",ty:"md",st:"indexed",imp:"28.10.2026",mod:"16.11.2026",tags:["roblox","design"],md:NOTE},
 {k:"file",ty:"luau",st:"indexed",imp:"28.10.2026",mod:"16.11.2026",tags:["roblox"],txt:"local Players = game:GetService(\"Players\")\n\n-- Spawn loop: one round every 90 seconds\nlocal function startRound()\n  for _, p in Players:GetPlayers() do\n    p:LoadCharacter()\n  end\nend"},
 {k:"note",ty:"md",st:"indexing",imp:"30.10.2026",mod:"15.11.2026",tags:["roblox","monetization"],md:"# Monetization\n\n## Game Passes\n- VIP-Lobby\n- Doppelte Münzen\n\nSiehe [[Map-Ideen]].\n\n#roblox #monetization"},
 {k:"file",ty:"rbxl",st:"nameonly",imp:"28.10.2026",mod:"16.11.2026",tags:["roblox"]},
 {k:"note",ty:"md",st:"indexed",imp:"12.11.2026",mod:"16.11.2026",tags:["neuralos","design"],md:"# NEURAL OS Spec\n\n## Visuelles Design\nDas Gehirn ist die Welt. Siehe [[Brain-Moodboard]].\n\n## Wissensbereich\nErsetzt Obsidian. GameLoop ist ein gutes Testprojekt.\n\n#neuralos #design"},
 {k:"file",ty:"png",st:"indexed",imp:"12.11.2026",mod:"12.11.2026",tags:["neuralos","design"],ocr:"NEURAL OS · brain · silver · glass · dark"},
 {k:"file",ty:"pdf",st:"failed",imp:"01.11.2026",mod:"01.11.2026",tags:[],err:"PDF encrypted"}];

export const CLAUDEMD=[{label:"CLAUDE.md",proj:"Roblox Game",md:"# Roblox Game\n\n- Luau, Rojo-Build mit `rojo build`\n- Tests vor jedem Commit\n\n<!-- NEURAL-OS:READINESS:BEGIN v1 -->\n…"},{label:"CLAUDE.md",proj:"NEURAL OS",md:"# NEURAL OS — project instructions\n\n- Claude works; NEURAL OS visualizes and organizes.\n- Never fake observability."}];

// Added by the v11 extension of the prototype.
FILES.push({n:"Scan-Vertrag.pdf",p:"Personal",s:"3.4 MB",i:false});

// Demo only: projects, shared links, connector pool, sessions, history and replay shown before real data exists.
export const PROJ={"Roblox Game":{notes:212,files:17980,links:1340,sess:24},"NEURAL OS":{notes:18,files:12,links:64,sess:3},"Personal":{notes:5974,files:420,links:8120,sess:4}};
export const SHARED={"NEURAL OS|Roblox Game":3,"Personal|Roblox Game":41,"NEURAL OS|Personal":9};
export const DEMO_POOL=[{n:"Roblox Studio",s:"ok",nv:"Game"},{n:"Notion",s:"ok",nv:"Knowledge"},{n:"Slack",s:"warn",nv:"Communication"},{n:"Google Drive",s:"ok",nv:"Files"},{n:"Canva",s:"ok",nv:"Design"},{n:"Linear",s:"bad",nv:"Tasks"},{n:"Spotify",s:"ok",nv:"Audio"}];
export const SESS=[{id:"Roblox Game",start:"20:01",sid:"a3f9…"},{id:"NEURAL OS",start:"20:09",sid:"7c21…"}];
export const HIST=[["dToday","19:58","Roblox Game","Read","Lobby.rbxl"],["dToday","19:41","NEURAL OS","WebSearch","three.js instancing"],["dToday","19:40","NEURAL OS","Edit","NEURAL OS Spec.md"],["dToday","19:12","Roblox Game","Error","rojo serve · port in use"],
 ["yesterday","21:58","Roblox Game","Stop","Roblox Game"],["yesterday","21:40","Roblox Game","Edit","GameLoop.luau"],["yesterday","21:31","Roblox Game","Agent","Explore"],["yesterday","21:12","Roblox Game","TodoWrite","4 tasks"],
 ["12.11","16:20","NEURAL OS","Read","Brain-Moodboard.png"],["12.11","16:05","NEURAL OS","Skill","artifact-design"]];
export const RPL={name:"Roblox Game",when:"21:12–21:58",ev:["planning","memory","execution","execution","research","memory","execution","subagents","workflows","execution","connectors","memory","execution","planning","execution","memory"]};
