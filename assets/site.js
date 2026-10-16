/* Game registry — add an entry here to publish a new game on the arcade. */
const GAMES = [
  {
    title: 'Windward',
    href: 'games/sailing/',
    blurb: 'A keelboat racing sim with real sail aerodynamics, apparent wind and a windward–leeward course. Steer with one thumb, trim with the other.',
    tags: ['Sailing', 'Simulation', 'Portrait', '3D'],
    art: `
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#7fc4ef"/><stop offset=".62" stop-color="#cfe8f6"/>
        </linearGradient>
        <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#1d6fa5"/><stop offset="1" stop-color="#0a3355"/>
        </linearGradient>
      </defs>
      <rect width="160" height="100" fill="url(#sky)"/>
      <circle cx="122" cy="24" r="11" fill="#fff3cf" opacity=".95"/>
      <rect y="54" width="160" height="46" fill="url(#sea)"/>
      <path d="M0 54h160v3H0z" fill="#ffffff" opacity=".28"/>
      <g transform="translate(58 30)">
        <path d="M18 3 L34 41 H18 Z" fill="#ffffff" opacity=".97"/>
        <path d="M15 11 L2 41 H15 Z" fill="#e4f1fb" opacity=".9"/>
        <path d="M17 3 L17 42" stroke="#4a6273" stroke-width="1"/>
        <path d="M-2 42 H38 L31 49 H4 Z" fill="#1b2b3a"/>
        <path d="M-2 42 H38 L37 44 H-1 Z" fill="#f2f6f8"/>
      </g>
      <g fill="#ffffff" opacity=".5">
        <ellipse cx="80" cy="81" rx="26" ry="3"/><ellipse cx="80" cy="88" rx="38" ry="3.4"/>
      </g>
      <g stroke="#ffffff" opacity=".18" stroke-width="1.4" fill="none">
        <path d="M6 66h34M112 70h42M22 76h30M100 82h44"/>
      </g>`
  },
  {
    title: 'Copycats',
    href: 'games/ski/',
    blurb: 'A downhill ski chase, endless or on the real Grand Targhee. Three riders copy your every line, jump and trick — skim the trees, hit the drops and spin until they crash.',
    tags: ['Skiing', 'Endless', 'Portrait', '3D'],
    art: `
      <defs>
        <linearGradient id="snow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#eef4fb"/><stop offset="1" stop-color="#cfdcee"/>
        </linearGradient>
      </defs>
      <rect width="160" height="100" fill="url(#snow)"/>
      <g fill="none" stroke="#9fb3d3" stroke-width="1.3" opacity=".9">
        <path d="M84 8 C70 26 96 40 80 56 S70 82 86 100"/>
        <path d="M87 8 C73 26 99 40 83 56 S73 82 89 100"/>
      </g>
      <g>
        <path d="M24 30 l9 -20 l9 20 z" fill="#2c5a45"/><path d="M28 21 l5 -11 l5 11 z" fill="#f1f6fc"/>
        <path d="M120 66 l10 -22 l10 22 z" fill="#24503f"/><path d="M125 55 l5 -11 l5 11 z" fill="#f1f6fc"/>
        <path d="M12 86 l8 -18 l8 18 z" fill="#386a4c"/><path d="M16 77 l4 -9 l4 9 z" fill="#f1f6fc"/>
        <path d="M132 22 l7 -15 l7 15 z" fill="#2c5a45"/>
        <ellipse cx="48" cy="58" rx="9" ry="4" fill="#7a7d88"/><path d="M40 57 q8 -6 16 0 z" fill="#f2f6fb"/>
      </g>
      <g stroke-linecap="round">
        <g transform="translate(84 74)"><path d="M-5 6 h10" stroke="#ffd44a" stroke-width="2"/>
          <rect x="-3" y="-8" width="6" height="9" rx="2" fill="#e8463a"/><circle cy="-11" r="2.6" fill="#f4f4f4"/></g>
        <g transform="translate(80 46) scale(.85)"><path d="M-5 6 h10" stroke="#2d2f39" stroke-width="2"/>
          <rect x="-3" y="-8" width="6" height="9" rx="2" fill="#ffbf26"/><circle cy="-11" r="2.6" fill="#2b2f3a"/></g>
        <g transform="translate(88 28) scale(.72)"><path d="M-5 6 h10" stroke="#ff6a3d" stroke-width="2"/>
          <rect x="-3" y="-8" width="6" height="9" rx="2" fill="#22b8a7"/><circle cy="-11" r="2.6" fill="#eaeaea"/></g>
        <g transform="translate(83 13) scale(.6)"><path d="M-6 6 h12" stroke="#9ff06a" stroke-width="3"/>
          <rect x="-3" y="-8" width="6" height="9" rx="2" fill="#8a5cf0"/><circle cy="-11" r="2.6" fill="#161616"/></g>
      </g>`
  },
  {
    title: 'Next up',
    soon: true,
    blurb: 'Something else small and physical. Ideas welcome in the repo issues.',
    tags: ['Soon'],
    art: `<rect width="160" height="100" fill="#082537"/>
      <g stroke="#3d6c8c" stroke-width="1.4" fill="none" opacity=".6">
        <circle cx="80" cy="50" r="22"/><path d="M80 34v32M64 50h32"/></g>`
  }
];

const PLAY_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1l9 5-9 5z" fill="currentColor"/></svg>';

const grid = document.getElementById('grid');
grid.innerHTML = GAMES.map(g => {
  const inner = `
    <div class="art">${g.soon ? '<span class="badge">soon</span>' : ''}
      <svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice">${g.art}</svg>
    </div>
    <div class="body">
      <h3>${g.title}</h3>
      <p>${g.blurb}</p>
      <div class="tags">${g.tags.map(t => `<span class="tag">${t}</span>`).join('')}</div>
      ${g.soon ? '' : `<span class="play">${PLAY_ICON} Play</span>`}
    </div>`;
  return `<li class="card${g.soon ? ' soon' : ''}">${g.soon ? inner : `<a href="${g.href}">${inner}</a>`}</li>`;
}).join('');
