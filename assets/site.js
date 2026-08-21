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
