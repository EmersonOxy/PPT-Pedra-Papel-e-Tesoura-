import type { CardDefinition } from '../game/types.ts';

// Formas vetoriais reproduzidas do protótipo V3 fornecido pelo usuário.
const shapes: Record<string, string> = {
  guardian: '<path d="M70 24 99 40 96 85 70 109 44 85 41 40Z" fill="#304e60" stroke="#c3f2df" stroke-width="4"/><path d="M70 40 85 49 82 79 70 92 58 79 55 49Z" fill="#7cc5b5"/><path d="M70 42V92M55 64h30" stroke="#f3e0a1" stroke-width="3"/><path d="M53 35 70 22 88 35" stroke="#ebd79b" stroke-width="4" fill="none"/>',
  fox: '<path d="M27 113C12 78 24 44 50 49 34 40 36 19 43 13L61 38 74 38 96 13 102 51C126 60 131 89 114 111L91 100 70 110 50 99Z" fill="#5a3f65" stroke="#efceba" stroke-width="4"/><path d="m50 55 15 10-18 5m43-15-15 10 18 5" fill="#d6ffff"/><path d="M61 84 70 91 79 84" stroke="#ffcc9d" stroke-width="4" fill="none"/><path d="M22 91C11 48 27 34 31 37M116 93C132 54 111 39 109 40" fill="none" stroke="#cdb8ee" stroke-width="6"/>',
  golem: '<path d="M36 39 59 25 88 33 108 53 103 100 71 115 37 105 27 76Z" fill="#3e594b" stroke="#d0c894" stroke-width="4"/><path d="M36 49 19 65 29 97 49 89M99 51 121 67 110 95 96 86" stroke="#8cad85" stroke-width="13" fill="none"/><path d="m51 65 13-4m13 0 13 4" stroke="#b9efad" stroke-width="5"/><path d="M59 85 72 91 85 84" stroke="#b6d9a0" stroke-width="3" fill="none"/><path d="M70 35 64 15M72 40 90 22" stroke="#a5c48d" stroke-width="4"/>',
  phoenix: '<path d="M69 112C33 104 32 73 13 59 35 61 41 68 48 69 30 44 33 30 27 12 47 23 57 35 70 53 83 28 93 17 110 13 102 32 110 42 95 69 108 65 117 58 132 54 112 73 107 102 69 112Z" fill="#a64a37" stroke="#f8c17d" stroke-width="4"/><path d="M70 103C45 81 56 69 70 44 90 71 92 84 70 103Z" fill="#f4b054"/><path d="M70 73 85 77 70 83" fill="#ffe3a2"/><path d="M57 41 47 22M88 41 102 20" stroke="#edb27c" stroke-width="5"/>',
  oracle: '<path d="M33 111C34 52 40 28 70 21 100 29 108 61 107 111" fill="#343450" stroke="#d3b3f6" stroke-width="4"/><path d="M47 58C49 41 59 36 70 33 83 38 92 46 93 59L83 84 57 84Z" fill="#ac8abf"/><path d="M53 64h34" stroke="#fff3d1" stroke-width="6"/><path d="M70 4 81 19 70 33 59 19Z" fill="#f1db96"/><path d="M34 110Q68 91 107 110" stroke="#d7bdab" stroke-width="4" fill="none"/>',
  blade: '<path d="M70 20 94 39 92 82 70 104 48 82 46 39Z" fill="#393c5e" stroke="#d5c2db" stroke-width="4"/><path d="M53 63h34M58 45 70 51 82 45" stroke="#e4edfa" stroke-width="5"/><path d="m36 112 22-49M110 112 82 63" stroke="#cbb4f5" stroke-width="8"/><path d="M57 71 42 90M83 71 98 90" stroke="#f6e0a6" stroke-width="3"/>',
  crystal: '<path d="m70 12 33 27-8 60-25 19-29-20-7-61Z" fill="#2a5c69" stroke="#8ee5df" stroke-width="4"/><path d="M70 12 68 106 34 37 103 39 68 106 95 99" stroke="#d6e8bb" stroke-width="2.5" fill="none"/><circle cx="70" cy="65" r="10" fill="#f0d796"/>',
  knight: '<path d="M45 111 31 75 48 44 58 21 87 21 99 46 113 78 99 112" fill="#684043" stroke="#ffd29a" stroke-width="4"/><path d="M55 46H88L82 73H61Z" fill="#b96849"/><path d="M58 54h26" stroke="#f8e5c6" stroke-width="5"/><path d="M70 17V5M43 18 55 26m48-8-17 8" stroke="#e7a972" stroke-width="5"/><path d="m39 106 31-23 31 23" fill="#dc9064" stroke="#ffe7c2" stroke-width="3"/>',
  eclipse: '<circle cx="71" cy="60" r="38" fill="#3f3a60" stroke="#dbb6e8" stroke-width="4"/><circle cx="84" cy="48" r="33" fill="#162b39"/><path d="M70 11V2M25 60H14M116 60h12M70 118v9" stroke="#e7cb91" stroke-width="4"/><circle cx="71" cy="60" r="6" fill="#eecb8e"/>',
  thorns: '<path d="M27 115C17 89 39 76 55 63 69 51 66 34 69 14M109 115C116 87 95 73 83 60 76 45 91 28 89 13" stroke="#87c49d" stroke-width="8" fill="none"/><path d="m31 84-14-16 24 6m14-12-17-16 26 4m29 14 21-17-4 26m-3 24 17-13-3 24" fill="#acbe85" stroke="#bde1ac" stroke-width="2"/><path d="M69 57 82 72 69 88 55 72Z" fill="#efd19b"/>',
  pulse: '<circle cx="70" cy="65" r="40" stroke="#ebd391" stroke-width="5" fill="#284859"/><circle cx="70" cy="65" r="25" stroke="#99d8cc" stroke-width="3" fill="none"/><path d="M70 13 82 50 120 65 82 80 70 117 56 80 20 65 56 50Z" fill="#b3ebd0" stroke="#fff2bc" stroke-width="3"/><circle cx="70" cy="65" r="7" fill="#fff1c4"/>',
  wildfire: '<path d="M70 113C31 108 33 81 47 65 54 58 60 47 59 18 76 36 83 48 79 68 92 55 97 40 95 29 123 70 117 107 70 113Z" fill="#bb584a" stroke="#f5be80" stroke-width="4"/><path d="M70 109C55 102 58 91 66 83 70 77 71 70 73 64 88 83 90 101 70 109Z" fill="#ffe2a0"/>',
};

const foundationColors: Record<CardDefinition['foundation'], [string, string]> = {
  guarda: ['#5A7F78', '#092906'],
  tecnica: ['#2779BB', '#010937'],
  impacto: ['#FE6C2B', '#340016'],
};

export function cardArtwork(definition: CardDefinition, instanceId: string): string {
  const safeId = instanceId.replace(/[^a-zA-Z0-9_-]/g, '-');
  let [tone, dark] = foundationColors[definition.foundation];
  if (definition.kind === 'hidden') [tone, dark] = ['#B10C43', '#02031A'];
  if (definition.kind === 'spell') [tone, dark] = definition.foundation === 'impacto' ? ['#FD1205', '#020F59'] : ['#0762A4', '#020F59'];
  const motif = shapes[definition.motif] ?? shapes.guardian;
  return `<svg viewBox="0 0 140 128" preserveAspectRatio="xMidYMid slice" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="art-${safeId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${tone}"/><stop offset="100%" stop-color="${dark}"/></linearGradient><radialGradient id="light-${safeId}"><stop offset="0%" stop-color="#fff2bf" stop-opacity=".65"/><stop offset="100%" stop-color="#f6e3a8" stop-opacity="0"/></radialGradient></defs><rect width="140" height="128" fill="url(#art-${safeId})"/><circle cx="70" cy="64" r="75" fill="url(#light-${safeId})" opacity=".5"/><g stroke="#e6e0b0" opacity=".25" fill="none"><circle cx="70" cy="67" r="48"/><path d="M0 106 140 106M0 18 140 18M7 64H133M70-20V150"/></g><path d="M-10 119 18 98 40 112 69 93 94 113 122 98 151 122V148H-10Z" fill="#102535" opacity=".48"/>${motif}</svg>`;
}
