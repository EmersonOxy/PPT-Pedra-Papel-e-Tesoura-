# Trindade

Repositório dos jogos do Trindade e do editor visual.

| Pasta | O que é |
|---|---|
| `games/pedra-papel-tesoura/` | Jogo original de Pedra, Papel e Tesoura (HTML + JS). |
| `games/trindade-card-battler/` | Jogo de cartas (TypeScript + Vite + Three.js). |
| `studio/` | Trindade Studio, editor visual do Pedra, Papel e Tesoura (Electron). Inclui `prototypes/` dos launchers Windows. |
| `docs/` | Arquitetura, auditoria, roadmap e guias. |
| `AGENTS.md`, `.agents/`, `.codex/` | Instruções e perfis dos agentes de IA. |

## Como jogar

**Pedra, Papel e Tesoura** — abra com dois cliques:

```
games/pedra-papel-tesoura/Jogar-Trindade-transicao-preta.html
```

**Card Battler** — precisa do Node.js. No PowerShell:

```powershell
cd games\trindade-card-battler
corepack pnpm install   # só na primeira vez
corepack pnpm dev
```

Abra `http://127.0.0.1:5173/` e mantenha o terminal aberto enquanto joga.
Se as animações não aparecerem, ligue **Configurações → Facilidade de Acesso → Vídeo → Mostrar animações no Windows**.

**Studio**:

```powershell
cd studio
corepack pnpm install   # só na primeira vez
corepack pnpm dev
```

## Deploy na Vercel

Cada jogo tem seu próprio `vercel.json`. No projeto da Vercel, defina **Root Directory** como `games/pedra-papel-tesoura` ou `games/trindade-card-battler`.
