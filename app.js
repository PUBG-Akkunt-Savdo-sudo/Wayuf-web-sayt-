/* ================= IMBA WAIFU — mini app (backend-connected) ================= */

/* ---- CONFIG: point this at your deployed backend ---- */
const API_BASE = window.IMBA_API_BASE || 'https://YOUR-BACKEND-DOMAIN/api';
const WS_BASE = API_BASE.replace(/^http/, 'ws').replace(/\/api$/, '');

/* ---- Telegram WebApp init ---- */
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  try { tg.setHeaderColor('#0a0518'); tg.setBackgroundColor('#0a0518'); } catch (e) {}
}
function haptic(type = 'light') {
  if (localStorage.getItem('haptic_disabled') === '1') return;
  try { tg?.HapticFeedback?.impactOccurred(type); } catch (e) {}
}

const INIT_DATA = tg?.initData || '';

/* ---- API helper: every call sends Telegram initData so the backend
   knows exactly which real user is asking (see backend/app/core/security.py) ---- */
async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': INIT_DATA,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

const RARITY_EMOJI = { Ordinary: '🃏', Rare: '💠', Special: '⚔️', Legend: '✨', Galaxy: '🌌', Unique: '👑' };
const FILTER_MAP = { Oddiy: 'Ordinary', Noyob: 'Galaxy', Maxsus: 'Special' };
const GAMES = [
  { key: 'chest',   icon: '🗝️',  name: 'Sandiq ochish',  desc: 'Tasodifiy karta oling',       cost: '🔑 1 kalit' },
  { key: 'wheel',   icon: '🎡',  name: 'Lucky Wheel',    desc: "Omad g'ildiragi",              cost: '🪙 500' },
  { key: 'jackpot', icon: '🎰',  name: 'Jackpot Slot',   desc: '3 bir xil = katta yutuq',      cost: '🪙 250' },
  { key: 'mini',    icon: '🎮',  name: 'Yulduz ovi',     desc: 'Yulduzni ushlang!',             cost: '🪙 300' },
  { key: 'memory',  icon: '🧠',  name: 'Memory Match',   desc: 'Juft kartalarni toping',        cost: '🪙 400' },
  { key: 'guess',   icon: '🔢',  name: 'Son topish',     desc: '5 urinishda sonni bil',         cost: '🪙 200' },
  { key: 'reflex',  icon: '⚡',  name: 'Reflex Tap',     desc: 'Signalga tez reaksiya bering',  cost: '🪙 350' },
];
const MISSIONS = [
  { id: 'm1', text: "3 ta o'yin o'ynash", reward: 1000 },
  { id: 'm2', text: '1 ta sandiq ochish', reward: 2000 },
  { id: 'm3', text: "1 ta karta almashtirish", reward: 1500 },
];

let user = null;      // from GET /api/users/me
let catalog = [];     // from GET /api/cards
let myCards = [];     // from GET /api/cards/mine
let listings = [];    // from GET /api/market/listings
let myListings = [];  // from GET /api/market/my-listings
let marketTab = 'buy';
let cardFilter = 'all';
let ws = null;

function fmt(n) { return Number(n || 0).toLocaleString('ru-RU'); }
/* ---- Card event overlay: bought/sold/returned/gifted/added-to-collection ----
   One shared component/config so every place a card enters, leaves, or moves
   in a user's collection shows the same style of animation — new events just
   need a new entry in CARD_EVENT_CONFIG plus a showCardEvent(...) call. */
const CARD_EVENT_CONFIG = {
  bought:   { icon: '🛒', title: 'KARTA SOTIB OLINDI!',   sub: 'Tabriklaymiz! Siz karta muvaffaqiyatli sotib oldingiz.', btn: "INVENTARYGA O'TDI" },
  sold:     { icon: '💰', title: 'KARTA SOTILDI!',        sub: 'Karta muvaffaqiyatli sotildi.',                          btn: "BALANSGA QO'SHILDI" },
  returned: { icon: '↩️', title: 'KARTA QAYTARILDI!',     sub: 'Karta muvaffaqiyatli qaytarib olindi.',                  btn: 'INVENTARYIMDA' },
  gifted:   { icon: '🎁', title: "KARTA SOVG'A QILINDI!", sub: 'Karta muvaffaqiyatli yuborildi.',                        btn: 'YUBORILDI' },
  added:    { icon: '✨', title: "YANGI KARTA QO'SHILDI!", sub: 'Kolleksiyangizga yangi karta qo\'shildi.',               btn: 'AJOYIB!' },
};
const CONFETTI_COLORS = ['#8b3dff','#c04dff','#ffc857','#4fd6e8','#3ee08a','#ff5c92'];

/* ===================== ❄️  WINTER SNOW SYSTEM ===================== */
const SEASON = 'winter'; // change to 'default' to disable

/* ---- Snow canvas ---- */
(function initSnow() {
  if (SEASON !== 'winter') return;
  const canvas = document.getElementById('snowCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const FLAKES = 42;
  const flakes = [];

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const SYMBOLS = ['❄','❅','❆','·','•'];
  for (let i = 0; i < FLAKES; i++) {
    flakes.push({
      x:    Math.random() * window.innerWidth,
      y:    Math.random() * window.innerHeight,
      r:    6 + Math.random() * 14,         // radius/font-size
      vx:   (Math.random() - .5) * .6,      // horizontal drift
      vy:   .4 + Math.random() * 1.1,       // fall speed
      sym:  SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
      alpha:  .15 + Math.random() * .45,
      sway:   Math.random() * Math.PI * 2,  // phase for sinusoidal drift
      swaySpd: .008 + Math.random() * .012,
    });
  }

  let lastSnowFrame = 0;
  function snowFrame(ts) {
    // Throttle to ~30fps to save battery
    if (ts - lastSnowFrame < 33) { requestAnimationFrame(snowFrame); return; }
    lastSnowFrame = ts;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textBaseline = 'middle';

    for (const f of flakes) {
      f.sway += f.swaySpd;
      f.x += f.vx + Math.sin(f.sway) * .5;
      f.y += f.vy;

      if (f.y > canvas.height + 20) {
        f.y = -20; f.x = Math.random() * canvas.width;
      }
      if (f.x < -20) f.x = canvas.width + 10;
      if (f.x > canvas.width + 20) f.x = -10;

      ctx.globalAlpha = f.alpha;
      ctx.font = `${f.r}px serif`;
      ctx.fillStyle = '#d0eaff';
      ctx.fillText(f.sym, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(snowFrame);
  }
  requestAnimationFrame(snowFrame);
})();

/* ---- Winter ice-flake confetti ---- */
const WINTER_FLAKES = ['❄','❅','❆','✦','⋆','⭐','💎','🌨'];

function launchConfetti(rarity) {
  const box = document.getElementById('cardEventConfetti');
  box.innerHTML = '';
  const isWinter = SEASON === 'winter';

  if (isWinter) {
    box.classList.add('winter');
    const count = 36;
    for (let i = 0; i < count; i++) {
      const s = document.createElement('span');
      s.textContent = WINTER_FLAKES[Math.floor(Math.random() * WINTER_FLAKES.length)];
      s.style.left   = (Math.random() * 110 - 5) + '%';
      s.style.top    = '-20px';
      s.style.position = 'absolute';
      s.style.setProperty('--dur',   (1.8 + Math.random() * 1.8) + 's');
      s.style.setProperty('--delay', (Math.random() * .6) + 's');
      // Rare+ cards get bigger, brighter flakes
      const big = ['Legend','Galaxy','Unique'].includes(rarity);
      s.style.fontSize = big ? (18 + Math.random() * 14) + 'px' : (10 + Math.random() * 10) + 'px';
      s.style.color = rarity === 'Galaxy'  ? '#c4b5fd' :
                      rarity === 'Legend'  ? '#fbbf24' :
                      rarity === 'Unique'  ? '#f472b6' : '#a8d8ff';
      box.appendChild(s);
    }
  } else {
    box.classList.remove('winter');
    const pieces = 28;
    for (let i = 0; i < pieces; i++) {
      const s = document.createElement('span');
      s.style.left = Math.random() * 100 + '%';
      s.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      s.style.animationDuration = (1.6 + Math.random() * 1.4) + 's';
      s.style.animationDelay   = (Math.random() * .4) + 's';
      box.appendChild(s);
    }
  }
}

function showCardEvent(type, card, fields = []) {
  const cfg = CARD_EVENT_CONFIG[type];
  if (!cfg || !card) return;
  const overlay = document.getElementById('cardEventOverlay');
  overlay.dataset.type = type;
  overlay.querySelector('.cardevent-icon span').textContent = cfg.icon;
  overlay.querySelector('.cardevent-title').textContent = cfg.title;
  overlay.querySelector('.cardevent-sub').textContent = cfg.sub;
  overlay.querySelector('.cardevent-btn').textContent = cfg.btn;
  overlay.querySelector('.cardevent-rarity').textContent = (card.rarity || '').toUpperCase();
  overlay.querySelector('.cardevent-art').textContent = RARITY_EMOJI[card.rarity] || '🃏';
  overlay.querySelector('.cardevent-name').textContent = card.name || '';
  overlay.querySelector('.cardevent-id').textContent = card.id ? `ID: #${card.id}` : (card.ownership_id ? `ID: #${card.ownership_id}` : '');
  overlay.querySelector('.cardevent-fields').innerHTML = fields
    .map(f => `<div class="cardevent-row"><span>${f.label}</span><b>${f.value}</b></div>`).join('');

  // ❄️ Winter rarity glow on the card panel
  const cardEl = overlay.querySelector('.cardevent-card');
  cardEl.className = 'cardevent-card'; // reset
  if (card.rarity) cardEl.classList.add(`rarity-${card.rarity.toLowerCase()}`);

  // ❄️ Winter title twinkle for rare+
  const titleEl = overlay.querySelector('.cardevent-title');
  const rareRarities = ['Legend','Galaxy','Unique'];
  if (SEASON === 'winter' && rareRarities.includes(card.rarity)) {
    titleEl.innerHTML = `❄ ${cfg.title} ❄`;
    titleEl.style.color = card.rarity === 'Unique' ? '#f472b6' :
                           card.rarity === 'Galaxy' ? '#c4b5fd' : '#fbbf24';
  } else {
    titleEl.innerHTML = cfg.title;
    titleEl.style.color = '';
  }

  overlay.hidden = false;
  launchConfetti(card.rarity);
  haptic('heavy');
}
function closeCardEvent() {
  const overlay = document.getElementById('cardEventOverlay');
  overlay.hidden = true;
  document.getElementById('cardEventConfetti').innerHTML = '';
}
document.getElementById('cardEventOverlay').addEventListener('click', (e) => {
  if (e.target.closest('.cardevent-btn') || e.target === e.currentTarget) closeCardEvent();
});

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---- Render helpers ---- */
function cardTile(c) {
  return `
  <div class="cardtile r-${c.rarity}">
    <div class="cardart">
      <span class="rarity-tag">${c.rarity.toUpperCase()}</span>
      ${RARITY_EMOJI[c.rarity] || '🃏'}
      ${c.is_limited ? '<span class="limited-badge">⏳ CHEKLANGAN</span>' : ''}
    </div>
    <div class="cardbody">
      <b>${c.name}</b>
      <div class="cardprice">🪙 ${fmt(c.base_price_ball)}</div>
      <button class="buybtn" data-buy="${c.id}">Sotib olish</button>
    </div>
  </div>`;
}

let featuredTimer = null;
async function loadFeatured() {
  try {
    const drops = await api('/market/featured');
    const banner = document.getElementById('featuredBanner');
    if (!drops.length) { banner.hidden = true; clearInterval(featuredTimer); return; }
    const d = drops[0];
    banner.hidden = false;
    document.getElementById('fArt').textContent = RARITY_EMOJI[d.card.rarity] || '🃏';
    document.getElementById('fName').textContent = d.card.name;
    clearInterval(featuredTimer);
    const endsAt = new Date(d.ends_at).getTime();
    const tick = () => {
      const diff = endsAt - Date.now();
      if (diff <= 0) { document.getElementById('fCountdown').textContent = 'Muddati tugadi...'; clearInterval(featuredTimer); loadFeatured(); return; }
      const h = Math.floor(diff / 3600000), m = Math.floor((diff % 3600000) / 60000), s = Math.floor((diff % 60000) / 1000);
      document.getElementById('fCountdown').textContent = `Qoldi: ${h}s ${m}d ${s}soniya`;
    };
    tick();
    featuredTimer = setInterval(tick, 1000);
  } catch (e) { /* silent — non-critical */ }
}

function renderTop() {
  if (!user) return;
  const avatarEl = document.getElementById('avatarInitial');
  avatarEl.textContent = user.avatar_url ? '' : user.name[0];
  avatarEl.style.backgroundImage = user.avatar_url ? `url('${user.avatar_url}')` : '';
  avatarEl.style.backgroundSize = 'cover';
  avatarEl.style.backgroundPosition = 'center';
  document.getElementById('balDiamond').textContent = fmt(user.diamond);
  document.getElementById('balBall').textContent = fmt(user.ball);
  document.getElementById('lvNum').textContent = 'Lv. ' + user.level;
  document.getElementById('lvRank').textContent = user.rank_title;
  document.getElementById('xpFill').style.width = Math.min(100, (user.xp / user.xp_next) * 100) + '%';
  document.getElementById('xpText').textContent = `${fmt(user.xp)} / ${fmt(user.xp_next)} XP`;
  document.getElementById('keyBadge').textContent = user.keys;
  const claimedToday = user.daily_claimed_at && new Date(user.daily_claimed_at).toDateString() === new Date().toDateString();
  document.getElementById('dailyDot').style.display = claimedToday ? 'none' : 'block';

  document.getElementById('profileName').textContent = user.name;
  document.getElementById('profileId').textContent = 'ID: ' + user.telegram_id;
  const profAvatar = document.getElementById('profileAvatar');
  profAvatar.textContent = user.avatar_url ? '' : user.name[0];
  profAvatar.style.backgroundImage = user.avatar_url ? `url('${user.avatar_url}')` : '';
  document.getElementById('profileVip').style.display = user.vip ? 'inline-block' : 'none';
  document.getElementById('statDiamond').textContent = fmt(user.diamond);
  document.getElementById('statKeys').textContent = user.keys;
  document.getElementById('statLevel').textContent = 'Lv.' + user.level;
}

function renderHome() {
  document.getElementById('topCards').innerHTML = catalog.slice(0, 3).map(cardTile).join('');

  const done = user?.missions_done || [];
  document.getElementById('missionCount').textContent = `${done.length}/${MISSIONS.length}`;
  document.getElementById('missionFill').style.width = (done.length / MISSIONS.length) * 100 + '%';
  document.getElementById('missionList').innerHTML = MISSIONS.map(m => {
    const isDone = done.includes(m.id);
    return `<li class="${isDone ? 'done' : ''}" data-mission="${m.id}">
      <span><i class="mcheck">✓</i>${m.text}</span><b>+${fmt(m.reward)}</b></li>`;
  }).join('');

  const sale = catalog[5] || catalog[0];
  if (sale) {
    document.getElementById('latestSale').innerHTML = `
      <div class="thumb">${RARITY_EMOJI[sale.rarity] || '🃏'}</div>
      <div><b>${sale.name}</b><small>🪙 ${fmt(sale.base_price_ball)}</small></div>`;
  }

  document.getElementById('rankList').innerHTML = '<li style="color:var(--dim)">Reyting tez orada</li>';

  const claimedToday = user?.chest_claimed_at && new Date(user.chest_claimed_at).toDateString() === new Date().toDateString();
  document.getElementById('dailyChestBanner').classList.toggle('claimed', !!claimedToday);
  document.getElementById('chestKeyCost').textContent = claimedToday ? 'Olindi ✓' : '🔑1';
}

function renderCards() {
  const list = cardFilter === 'all' ? catalog : catalog.filter(c => c.rarity === FILTER_MAP[cardFilter]);
  document.getElementById('allCards').innerHTML = list.map(cardTile).join('') ||
    '<p style="color:var(--dim);grid-column:1/-1;text-align:center">Kartalar topilmadi</p>';
}

function renderMarket() {
  document.getElementById('marketStats').innerHTML = `
    <div class="sbox"><b>${listings.length}</b><small>Sotuvda</small></div>
    <div class="sbox"><b>${fmt(user?.ball)}</b><small>Balansingiz</small></div>
    <div class="sbox"><b>${myCards.length}</b><small>Kolleksiyam</small></div>`;

  if (marketTab === 'buy') {
    document.getElementById('marketList').innerHTML = listings.length ? listings.map(l => `
      <div class="listrow">
        <div class="thumb">${RARITY_EMOJI[l.card.rarity] || '🃏'}</div>
        <div class="info"><b>${l.card.name}</b><small>@${l.seller_name}</small></div>
        <span class="price">🪙${fmt(l.price_ball)}</span>
        <button class="actbtn" data-buylisting="${l.id}">Sotib olish</button>
      </div>`).join('') : '<p style="color:var(--dim);text-align:center">Hozircha e\'lon yo\'q</p>';
  } else {
    const myListingsHtml = myListings.length ? `
      <div class="listrow-heading">Faol e'lonlarim</div>
      ${myListings.map(l => `
      <div class="listrow">
        <div class="thumb">${RARITY_EMOJI[l.card.rarity] || '🃏'}</div>
        <div class="info"><b>${l.card.name}</b><small>Sotuvda · 🪙${fmt(l.price_ball)}</small></div>
        <button class="actbtn" data-cancellisting="${l.id}">Bekor qilish</button>
      </div>`).join('')}
      <div class="listrow-heading">Sotuvga qo'yish</div>` : '';
    document.getElementById('marketList').innerHTML = myListingsHtml + (myCards.length ? myCards.map(c => `
      <div class="listrow">
        <div class="thumb">${RARITY_EMOJI[c.rarity] || '🃏'}</div>
        <div class="info"><b>${c.name}</b><small>Kolleksiyangizda</small></div>
        <span class="price">🪙${fmt(c.base_price_ball)}</span>
        <button class="actbtn sell" data-sellcard="${c.ownership_id}" data-price="${c.base_price_ball}">Sotuvga qo'yish</button>
        <button class="actbtn gift" data-giftcard="${c.ownership_id}" data-cardname="${c.name}">🎁 Sovg'a</button>
      </div>`).join('') : '<p style="color:var(--dim);text-align:center">Sizda hali karta yo\'q</p>');
  }
}

function renderGames() {
  const frozen = user?.freeze_until && Date.now() < new Date(user.freeze_until).getTime();
  document.getElementById('freezeNote').hidden = !frozen;
  document.getElementById('gameGrid').innerHTML = GAMES.map(g => `
    <div class="gametile">
      <span>${g.icon}</span><b>${g.name}</b><small>${g.desc} · ${g.cost}</small>
      <button class="gobtn" data-game="${g.key}" ${frozen ? 'disabled style="opacity:.4"' : ''}>Boshlash</button>
    </div>`).join('');
}

function renderAll() { renderTop(); renderHome(); renderCards(); renderMarket(); renderGames(); }

let currentRoom = 'global';

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.dataset.view === name));
  document.querySelectorAll('.navbtn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (name === 'chat' && !ws) connectChat(currentRoom);
}

/* ================= Actions (each hits the real backend) ================= */
async function claimDaily() {
  try { user = await api('/users/daily-bonus', { method: 'POST' }); renderTop(); toast('+2,000 🪙 kunlik bonus!'); haptic('medium'); }
  catch (e) { toast(e.message); }
}
async function claimMission(id) {
  try { user = await api(`/users/claim-mission/${id}`, { method: 'POST' }); renderTop(); renderHome(); toast('Mukofot olindi!'); haptic('light'); }
  catch (e) { toast(e.message); }
}
/* ========================= GAME MODAL SYSTEM ========================= */

/* Wheel segment definitions — must match backend WHEEL_SEGMENTS weights */
const W_SEGS = [
  { reward: 50,   color: '#2563eb', w: 40 },
  { reward: 150,  color: '#7c3aed', w: 25 },
  { reward: 300,  color: '#059669', w: 15 },
  { reward: 700,  color: '#d97706', w: 10 },
  { reward: 1500, color: '#dc2626', w:  7 },
  { reward: 5000, color: '#f59e0b', w:  3 },
];
const W_TOTAL = W_SEGS.reduce((s, x) => s + x.w, 0);

/* Jackpot symbols — same order as backend */
const J_SYMS = ['🍒', '🍋', '🔔', '⭐', '💎', '🎰'];

function _gmodalEl(id) { return document.getElementById(id); }

function openGameModal(title) {
  _gmodalEl('gmodal-title').textContent = title;
  _gmodalEl('gmodal-result').hidden = true;
  _gmodalEl('gmodal-close').hidden   = true;
  _gmodalEl('gmodal-body').innerHTML = '';
  const m = _gmodalEl('gameModal');
  m.hidden = false;
  requestAnimationFrame(() => m.classList.add('show'));
  document.body.style.overflow = 'hidden';
}

function closeGameModal() {
  const m = _gmodalEl('gameModal');
  m.classList.remove('show');
  setTimeout(() => {
    m.hidden = true;
    document.body.style.overflow = '';
    renderTop();
    renderGames();
  }, 360);
}

function showGameResult(win, rewardBall, extra) {
  const el = _gmodalEl('gmodal-result');
  el.hidden = false;
  const cls = win ? 'gres-win' : 'gres-lose';

  // ❄️ Winter ice burst on win
  let winterBurst = '';
  if (win && SEASON === 'winter') {
    winterBurst = `<div class="gres-ice-burst" id="gresBurst"></div>`;
  }

  el.innerHTML = `${winterBurst}<div class="${cls} gres-anim">
    <div class="gres-icon">${win ? '🏆' : '💫'}</div>
    <div class="gres-title">${win ? `G'ALABA! +${fmt(rewardBall)} 🪙` : "Keyingi safar omad!"}</div>
    ${extra ? `<div class="gres-sub">${extra}</div>` : ''}
  </div>`;

  if (win && SEASON === 'winter') {
    const burst = _gmodalEl('gresBurst');
    if (burst) {
      const pieces = ['❄','❅','❆','⭐','✦'];
      for (let i = 0; i < 12; i++) {
        const s = document.createElement('span');
        s.textContent = pieces[i % pieces.length];
        const ang = (i / 12) * Math.PI * 2;
        s.style.cssText = `
          position:absolute;font-size:${14+Math.random()*10}px;
          left:50%;top:50%;
          --tx:${Math.cos(ang)*(50+Math.random()*40)}px;
          --ty:${Math.sin(ang)*(50+Math.random()*40)}px;
          animation:pFly .9s ease-out ${i*40}ms forwards;
          color:${['#a8d8ff','#fbbf24','#c4b5fd'][i%3]};
        `;
        burst.appendChild(s);
      }
    }
  }

  _gmodalEl('gmodal-close').hidden = false;
  haptic(win ? 'medium' : 'light');
}

/* ---- WHEEL ---- */
function _drawWheel(canvas, rotation) {
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2, cy = canvas.height / 2, r = cx - 5;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Outer glow ring
  const glow = ctx.createRadialGradient(cx, cy, r - 6, cx, cy, r + 6);
  glow.addColorStop(0, 'rgba(120,70,255,.4)');
  glow.addColorStop(1, 'transparent');
  ctx.beginPath(); ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
  ctx.fillStyle = glow; ctx.fill();

  let a = rotation - Math.PI / 2;
  W_SEGS.forEach(seg => {
    const slice = (seg.w / W_TOTAL) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a, a + slice);
    ctx.closePath();
    ctx.fillStyle = seg.color; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1.5; ctx.stroke();

    // Prize label
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a + slice / 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${seg.reward >= 1000 ? 9 : 11}px system-ui`;
    ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 4;
    ctx.fillText(`🪙${seg.reward}`, r - 8, 4);
    ctx.restore();
    a += slice;
  });

  // Center cap
  ctx.beginPath(); ctx.arc(cx, cy, 20, 0, Math.PI * 2);
  const cap = ctx.createRadialGradient(cx - 4, cy - 4, 2, cx, cy, 20);
  cap.addColorStop(0, '#fff'); cap.addColorStop(1, '#888');
  ctx.fillStyle = cap; ctx.fill();
  ctx.strokeStyle = '#fff3'; ctx.lineWidth = 2; ctx.stroke();
}

function showWheelGame(rewardBall) {
  _gmodalEl('gmodal-body').innerHTML = `
    <div class="wheel-wrap">
      <div class="wheel-pointer">▼</div>
      <canvas id="wheelCanvas" width="268" height="268"></canvas>
      <div class="wheel-hint">G'ildirak aylanmoqda...</div>
    </div>`;

  const canvas = _gmodalEl('wheelCanvas');
  _drawWheel(canvas, 0);

  // Find winning segment index
  let segIdx = W_SEGS.findIndex(s => s.reward === rewardBall);
  if (segIdx < 0) segIdx = 0;

  // Cumulative angle to segment center
  let cumW = 0;
  for (let i = 0; i < segIdx; i++) cumW += W_SEGS[i].w;
  const segMidFrac = (cumW + W_SEGS[segIdx].w * 0.5) / W_TOTAL;
  // To land segment under top pointer: rotate so segment center = top
  const landAngle = segMidFrac * Math.PI * 2;
  const spinRounds = (6 + Math.random()) * Math.PI * 2;
  const totalAngle = spinRounds + landAngle;

  const dur = 3400, t0 = performance.now();
  const ease = t => 1 - Math.pow(1 - t, 4);

  (function frame(now) {
    const p = Math.min((now - t0) / dur, 1);
    _drawWheel(canvas, ease(p) * totalAngle);
    if (p < 1) requestAnimationFrame(frame);
    else showGameResult(true, rewardBall, `${W_SEGS[segIdx].reward}x segment!`);
  })(t0);
}

/* ---- JACKPOT / SLOT ---- */
function showJackpotGame(reels, win, rewardBall) {
  _gmodalEl('gmodal-body').innerHTML = `
    <div class="slot-machine">
      <div class="slot-title">🎰 JACKPOT SLOT</div>
      <div class="slot-reels">
        ${reels.map((_, i) => `<div class="slot-reel"><span class="slot-sym spinning" id="rs${i}">🎰</span></div>`).join('')}
      </div>
      <div class="slot-lights">${'<div class="slot-light"></div>'.repeat(7)}</div>
    </div>`;

  reels.forEach((target, i) => {
    const el = _gmodalEl(`rs${i}`);
    const iv = setInterval(() => { el.textContent = J_SYMS[Math.floor(Math.random() * J_SYMS.length)]; }, 85);
    setTimeout(() => {
      clearInterval(iv);
      el.classList.remove('spinning');
      el.textContent = target;
      el.classList.add('stop');
      if (i === reels.length - 1) {
        const isTriple = reels[0] === reels[1] && reels[1] === reels[2];
        const extra = isTriple
          ? (reels[0] === '🎰' ? '🚀 MEGA JACKPOT — barcha pool sizniki!' : `3x ${reels[0]} uchlik kombinatsiya!`)
          : (win ? 'Juft kombinatsiya!' : '');
        if (isTriple) _gmodalEl('gmodal-sheet')?.classList.add('jackpot-flash');
        setTimeout(() => showGameResult(win, rewardBall, extra), 650);
      }
    }, 820 + i * 680);
  });
}

/* ---- MINI GAME ---- */
function showMiniGame(win, rewardBall) {
  _gmodalEl('gmodal-body').innerHTML = `
    <div class="mini-wrap">
      <div class="mini-arena" id="miniArena">
        <span class="mini-target" id="miniTarget">⭐</span>
        <div class="mini-timer-bar" id="miniBar" style="width:100%"></div>
        <div class="mini-countdown" id="miniCountdown">3</div>
        <div class="mini-score" id="miniScore">Ushlang!</div>
      </div>
      <div class="mini-hint">⭐ Yulduzni bosib qo'lga oling!</div>
    </div>`;

  const arena  = _gmodalEl('miniArena');
  const target = _gmodalEl('miniTarget');
  const bar    = _gmodalEl('miniBar');
  const countEl= _gmodalEl('miniCountdown');
  const scoreEl= _gmodalEl('miniScore');
  const totalMs = 3000;
  const W = arena.clientWidth || 300, H = arena.clientHeight || 234;

  let px = W/2 - 25, py = H/2 - 25;
  let vx = (3 + Math.random()*2) * (Math.random() > .5 ? 1 : -1);
  let vy = (3 + Math.random()*2) * (Math.random() > .5 ? 1 : -1);
  let done = false, lastT = performance.now();
  let remaining = totalMs;

  target.style.left = px + 'px'; target.style.top = py + 'px';

  function moveBall(now) {
    if (done) return;
    const dt = now - lastT; lastT = now;
    remaining -= dt;
    const pct = Math.max(0, remaining / totalMs * 100);
    bar.style.width = pct + '%';
    countEl.textContent = Math.ceil(remaining / 1000);

    px += vx * (dt / 10); py += vy * (dt / 10);
    if (px <= 0 || px >= W - 50) { vx *= -1; px = Math.max(0, Math.min(W - 50, px)); }
    if (py <= 0 || py >= H - 50) { vy *= -1; py = Math.max(0, Math.min(H - 50, py)); }
    target.style.left = px + 'px'; target.style.top = py + 'px';

    // Speed increases over time for difficulty
    const speedMul = 1 + (1 - pct/100) * 0.8;
    target.style.filter = `drop-shadow(0 0 ${8 + speedMul*4}px gold)`;

    if (remaining <= 0) {
      done = true;
      target.textContent = '💨';
      scoreEl.textContent = 'Qochib ketdi!';
      setTimeout(() => showGameResult(win, rewardBall, win ? 'Omad yordamida yutdingiz 🍀' : ''), 500);
      return;
    }
    requestAnimationFrame(moveBall);
  }

  target.addEventListener('pointerdown', () => {
    if (done) return; done = true;
    target.textContent = '💥';
    target.style.filter = 'none';
    scoreEl.textContent = '💥 Urildi!';
    haptic('medium');
    setTimeout(() => showGameResult(win, rewardBall, win ? '🎯 Aniq urildi!' : 'Yaxshi urinish!'), 420);
  }, { once: true });

  requestAnimationFrame(moveBall);
}

/* ---- CHEST ---- */
function showChestGame(onOpen) {
  _gmodalEl('gmodal-body').innerHTML = `
    <div class="chest-wrap">
      <span class="chest-emoji" id="chestEmoji">🎁</span>
      <div class="chest-hint">Sandiqga bosing!</div>
      <div class="chest-particles" id="chestParts"></div>
    </div>`;

  let opened = false;
  const emoji = _gmodalEl('chestEmoji');

  emoji.addEventListener('pointerdown', () => {
    if (opened) return; opened = true;
    haptic('medium');
    emoji.classList.add('shake');

    setTimeout(() => {
      emoji.classList.remove('shake');
      emoji.classList.add('open');

      const parts = _gmodalEl('chestParts');
      ['✨','⭐','🌟','💎','🎊','💫','🔮','🌈'].forEach((s, i) => {
        const el = document.createElement('span');
        el.className = 'particle';
        el.textContent = s;
        const ang = (i / 8) * Math.PI * 2;
        el.style.setProperty('--tx', `${Math.cos(ang) * (60 + Math.random()*40)}px`);
        el.style.setProperty('--ty', `${Math.sin(ang) * (60 + Math.random()*40) - 40}px`);
        el.style.animationDelay = `${i * 55}ms`;
        parts.appendChild(el);
      });

      setTimeout(onOpen, 300);
    }, 480);
  }, { once: true });
}

/* ---- MEMORY MATCH ---- */
function showMemoryGame(serverResult) {
  const EMOJIS = ['🌸','🔥','💎','⭐','🎭','🌊'];
  const pairs = [...EMOJIS, ...EMOJIS].sort(() => Math.random() - .5);
  let flipped = [], matched = [], locked = false, foundCount = 0;

  _gmodalEl('gmodal-body').innerHTML = `
    <div class="memory-wrap">
      <div class="memory-info">
        <span class="memory-pairs" id="memPairs">Topilgan: 0 / 6</span>
        <span class="memory-tries" id="memTries">Urinishlar: 0</span>
      </div>
      <div class="memory-grid" id="memGrid"></div>
    </div>`;

  const grid = _gmodalEl('memGrid');
  pairs.forEach((emoji, i) => {
    const card = document.createElement('div');
    card.className = 'mem-card'; card.dataset.idx = i; card.dataset.val = emoji;
    card.innerHTML = `<div class="mem-inner"><div class="mem-front">?</div><div class="mem-back">${emoji}</div></div>`;
    grid.appendChild(card);
  });

  let tries = 0;
  grid.addEventListener('click', e => {
    const card = e.target.closest('.mem-card');
    if (!card || locked || flipped.includes(card) || card.classList.contains('mem-matched')) return;
    card.classList.add('mem-flip'); flipped.push(card);

    if (flipped.length === 2) {
      tries++; locked = true;
      _gmodalEl('memTries').textContent = `Urinishlar: ${tries}`;
      const [a, b] = flipped;
      if (a.dataset.val === b.dataset.val) {
        a.classList.add('mem-matched'); b.classList.add('mem-matched');
        foundCount++; flipped = []; locked = false;
        _gmodalEl('memPairs').textContent = `Topilgan: ${foundCount} / 6`;
        if (foundCount === 6) setTimeout(() => showGameResult(serverResult.win, serverResult.reward_ball, `${tries} urinishda barcha juftlar topildi! 🎉`), 400);
      } else {
        setTimeout(() => { a.classList.remove('mem-flip'); b.classList.remove('mem-flip'); flipped = []; locked = false; }, 900);
      }
    }
  });

  // Auto-finish: if server says time ran out (win with partial find)
  // Show result after 45s if not done
  setTimeout(() => {
    if (foundCount < 6) showGameResult(serverResult.win, serverResult.reward_ball,
      `${foundCount} juft topildi (${serverResult.found_pairs} ta hisobga olindi)`);
  }, 45000);
}

/* ---- NUMBER GUESS ---- */
function showGuessGame(serverResult) {
  const secret = serverResult.secret;
  let tries = 0, maxTries = serverResult.max_tries, done = false;

  _gmodalEl('gmodal-body').innerHTML = `
    <div class="guess-wrap">
      <div class="guess-title">1 – 100 orasidagi sonni toping!</div>
      <div class="guess-tries-left" id="gTries">${maxTries} ta urinish qoldi</div>
      <div class="guess-hint" id="gHint">🔢 Son kiriting va tekshiring</div>
      <div class="guess-input-row">
        <input class="guess-input" id="gInput" type="number" min="1" max="100" placeholder="1-100">
        <button class="actbtn" id="gBtn">✓</button>
      </div>
      <div class="guess-history" id="gHistory"></div>
    </div>`;

  function check() {
    if (done) return;
    const val = parseInt(_gmodalEl('gInput').value, 10);
    if (!val || val < 1 || val > 100) { _gmodalEl('gHint').textContent = '⚠️ 1 va 100 orasida son kiriting'; return; }
    tries++;
    const left = maxTries - tries;
    _gmodalEl('gTries').textContent = `${left} ta urinish qoldi`;
    _gmodalEl('gInput').value = '';

    const diff = Math.abs(val - secret);
    let hint = '', icon = '';
    if (val === secret) {
      done = true; haptic('medium');
      setTimeout(() => showGameResult(true, serverResult.reward_ball, `${tries} ta urinishda topdingiz! 🎯`), 300);
      return;
    }
    if (diff <= 5)  { hint = 'Juda issiq! 🔥'; icon = '🔴'; }
    else if (diff <= 15) { hint = 'Issiq ♨️'; icon = '🟠'; }
    else if (diff <= 30) { hint = "Iliq 🌤"; icon = '🟡'; }
    else { hint = 'Sovuq ❄️'; icon = '🔵'; }
    hint += val < secret ? ' (yuqoriga ▲)' : ' (pastga ▼)';
    _gmodalEl('gHint').textContent = hint;

    const row = document.createElement('div');
    row.className = 'guess-hist-row';
    row.innerHTML = `<span>${icon}</span><b>${val}</b><small>${hint}</small>`;
    _gmodalEl('gHistory').prepend(row);

    if (left <= 0) {
      done = true;
      setTimeout(() => showGameResult(serverResult.win, 0, `Son ${secret} edi. Keyingi safar omad!`), 400);
    }
  }

  _gmodalEl('gBtn').addEventListener('click', check);
  _gmodalEl('gInput').addEventListener('keydown', e => e.key === 'Enter' && check());
}

/* ---- REFLEX TAP ---- */
function showReflexGame(serverResult) {
  const { signal_delay_ms, win_threshold_ms, win, reward_ball, reaction_ms } = serverResult;
  let phase = 'wait', tapTime = null, signalTime = null;

  _gmodalEl('gmodal-body').innerHTML = `
    <div class="reflex-wrap">
      <div class="reflex-instruction" id="rfInst">Tayyor bo'ling...</div>
      <div class="reflex-arena" id="rfArena">
        <div class="reflex-target" id="rfTarget">⏳</div>
      </div>
      <div class="reflex-hint">Signal paydo bo'lganda — ZUM bosing!</div>
    </div>`;

  const arena = _gmodalEl('rfArena');
  const target = _gmodalEl('rfTarget');
  const inst = _gmodalEl('rfInst');

  // Countdown before signal
  let countdown = 3;
  const cdInterval = setInterval(() => {
    if (countdown > 0) { inst.textContent = `${countdown}... tayyor bo'ling`; countdown--; }
    else clearInterval(cdInterval);
  }, 1000);

  // Signal appears after delay
  setTimeout(() => {
    phase = 'signal'; signalTime = performance.now();
    target.textContent = '🟢'; target.style.fontSize = '80px';
    target.style.filter = 'drop-shadow(0 0 30px #00ff00)';
    inst.textContent = 'BOSING! ⚡';
    inst.style.color = '#4ade80';
    haptic('light');

    // Auto-fail after 1.2s
    setTimeout(() => {
      if (phase !== 'tapped') {
        phase = 'done';
        target.textContent = '💨'; target.style.filter = 'none';
        setTimeout(() => showGameResult(win, reward_ball,
          win ? `Server: ${reaction_ms}ms — yaxshi! ⚡` : `Kechikdingiz. Threshold: ${win_threshold_ms}ms`), 300);
      }
    }, 1200);
  }, signal_delay_ms);

  arena.addEventListener('pointerdown', () => {
    if (phase === 'wait') {
      inst.textContent = '⚠️ Juda erta! Signalni kuting';
      inst.style.color = '#f87171';
      haptic('light');
      return;
    }
    if (phase !== 'signal') return;
    phase = 'tapped'; tapTime = performance.now();
    const actual = Math.round(tapTime - signalTime);
    target.textContent = win ? '⚡' : '🐢';
    target.style.filter = `drop-shadow(0 0 20px ${win ? 'gold' : '#888'})`;
    haptic(win ? 'medium' : 'light');
    setTimeout(() => showGameResult(win, reward_ball,
      win ? `Reaksiya: ${actual}ms — ajoyib! ⚡` : `Reaksiya: ${actual}ms — kerakli: ${win_threshold_ms}ms`), 350);
  });
}

/* ========================= UPDATED playGame dispatcher ========================= */
async function playGame(key) {
  if (key === 'chest') { openChest(); return; }

  const titles = {
    wheel: '🎡 Lucky Wheel', jackpot: '🎰 Jackpot Slot', mini: '🎮 Yulduz ovi',
    memory: '🧠 Memory Match', guess: '🔢 Son topish', reflex: '⚡ Reflex Tap',
  };
  openGameModal(titles[key] || key);

  try {
    const res = await api(`/games/play/${key}`, { method: 'POST' });
    user = res.user;

    if      (key === 'wheel')   showWheelGame(res.reward_ball);
    else if (key === 'jackpot') showJackpotGame(res.reels, res.win, res.reward_ball);
    else if (key === 'mini')    showMiniGame(res.win, res.reward_ball);
    else if (key === 'memory')  showMemoryGame(res);
    else if (key === 'guess')   showGuessGame(res);
    else if (key === 'reflex')  showReflexGame(res);
    else showGameResult(res.win, res.reward_ball);

  } catch (e) { closeGameModal(); toast(e.message); }
}

/* ========================= UPDATED openChest ========================= */
async function openChest() {
  openGameModal('🗝️ Sandiq ochish');
  showChestGame(async () => {
    try {
      const res = await api('/chest/open', { method: 'POST' });
      user = res.user;
      renderHome();
      const card = res.won_card;
      const el = _gmodalEl('gmodal-result');
      el.hidden = false;
      el.innerHTML = `<div class="gres-win gres-anim">
        <div class="gres-icon">${RARITY_EMOJI[card.rarity] || '🃏'}</div>
        <div class="gres-title">${card.name}</div>
        <div class="gres-sub">${card.rarity.toUpperCase()} daraja karta qo'lga kiritildi! ✨</div>
      </div>`;
      _gmodalEl('gmodal-close').hidden = false;
      haptic('medium');
      loadMyCards();
    } catch (e) { closeGameModal(); toast(e.message); }
  });
}
async function buyFromShop(templateId) {
  try {
    const res = await api(`/market/shop/buy/${templateId}`, { method: 'POST' });
    user = res.user;
    renderTop();
    const card = catalog.find(c => c.id === templateId);
    if (card) {
      showCardEvent('bought', card, [
        { label: 'Narxi', value: `🪙 ${fmt(card.base_price_ball)}` },
        { label: 'Sotuvchi', value: 'Do\'kon' },
        { label: 'Sotib oluvchi', value: '@Siz' },
        { label: 'Sana', value: new Date().toLocaleString('ru-RU') },
      ]);
    } else toast('Karta sotib olindi!');
    loadMyCards();
  } catch (e) { toast(e.message); }
}
async function buyListing(listingId) {
  try {
    const listing = listings.find(l => l.id === listingId);
    const res = await api(`/market/buy/${listingId}`, { method: 'POST' });
    user = res.user;
    renderTop();
    if (listing) {
      showCardEvent('bought', listing.card, [
        { label: 'Narxi', value: `🪙 ${fmt(listing.price_ball)}` },
        { label: 'Sotuvchi', value: `@${listing.seller_name}` },
        { label: 'Sotib oluvchi', value: '@Siz' },
        { label: 'Sana', value: new Date().toLocaleString('ru-RU') },
      ]);
    } else toast('Karta sotib olindi!');
    await Promise.all([loadListings(), loadMyCards()]);
    renderMarket();
  } catch (e) { toast(e.message); }
}
async function sellCard(ownershipId, price) {
  try {
    await api('/market/list', { method: 'POST', body: JSON.stringify({ ownership_id: Number(ownershipId), price_ball: Number(price) }) });
    toast('Sotuvga qo\'yildi!');
    await Promise.all([loadListings(), loadMyListings(), loadMyCards()]);
    renderMarket();
  } catch (e) { toast(e.message); }
}
async function giftCard(ownershipId, cardName) {
  const recipientId = prompt(
    `🎁 "${cardName}" kartasini sovg'a qilish\n\nQabul qiluvchining Telegram ID raqamini kiriting:`
  );
  if (!recipientId) return;
  const tid = parseInt(recipientId.trim(), 10);
  if (!tid || isNaN(tid)) { toast('Noto\'g\'ri Telegram ID'); return; }
  try {
    const res = await api('/market/gift', {
      method: 'POST',
      body: JSON.stringify({ ownership_id: Number(ownershipId), recipient_telegram_id: tid }),
    });
    showCardEvent('gifted', res.template, [
      { label: 'Qabul qiluvchi ID', value: tid },
      { label: 'Sana', value: new Date().toLocaleString('ru-RU') },
    ]);
    await loadMyCards();
    renderMarket();
  } catch (e) { toast(e.message); }
}
async function cancelListing(listingId) {
  try {
    const listing = myListings.find(l => l.id === listingId);
    await api(`/market/cancel/${listingId}`, { method: 'POST' });
    if (listing) {
      showCardEvent('returned', listing.card, [
        { label: 'Avvalgi holat', value: 'Sotuvda' },
        { label: 'Hozirgi holat', value: '@Siz' },
        { label: 'Sana', value: new Date().toLocaleString('ru-RU') },
      ]);
    } else toast('E\'lon bekor qilindi');
    await Promise.all([loadListings(), loadMyListings(), loadMyCards()]);
    renderMarket();
  } catch (e) { toast(e.message); }
}
// playGame and openChest are defined above in GAME MODAL SYSTEM

/* ---- Chat (WebSocket) ---- */
function chatBubble(m) {
  const mine = user && m.user_id === user.id;
  const avatar = m.avatar_url
    ? `<span class="chatavatar" style="background-image:url('${m.avatar_url}')"></span>`
    : `<span class="chatavatar">${(m.name || '?')[0]}</span>`;
  return `<div class="chatmsg-row ${mine ? 'mine' : ''}">
    ${mine ? '' : avatar}
    <div class="chatmsg ${mine ? 'mine' : ''}">
      <b>${mine ? 'Siz' : m.name}${m.rank_title ? ` <i class="chatrank">· ${m.rank_title} Lv.${m.level}</i>` : ''}</b>
      ${m.text}
    </div>
  </div>`;
}
async function loadChatHistory(room) {
  try {
    const rows = await api(`/chat/history?room=${room}`);
    document.getElementById('chatBox').innerHTML = rows.map(chatBubble).join('');
    scrollChatToBottom();
  } catch (e) { /* silent — chat is non-critical */ }
}
function scrollChatToBottom() {
  const box = document.getElementById('chatBox');
  box.scrollTop = box.scrollHeight;
}
function connectChat(room) {
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  document.getElementById('chatBox').innerHTML = '';
  loadChatHistory(room);
  const url = `${WS_BASE}/ws/chat?init_data=${encodeURIComponent(INIT_DATA)}&room=${room}`;
  ws = new WebSocket(url);
  ws.onmessage = (evt) => {
    const m = JSON.parse(evt.data);
    document.getElementById('chatBox').insertAdjacentHTML('beforeend', chatBubble(m));
    scrollChatToBottom();
  };
  ws.onclose = () => { ws = null; };
}

document.getElementById('chatRoomTabs').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-room]');
  if (!tab) return;
  document.querySelectorAll('#chatRoomTabs .tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  currentRoom = tab.dataset.room;
  connectChat(currentRoom);
  haptic('light');
});

/* ================= Data loaders ================= */
async function loadCatalog() { catalog = await api('/cards'); }
async function loadMyCards() { myCards = await api('/cards/mine'); }
async function loadListings() { listings = await api('/market/listings'); }
async function loadMyListings() { myListings = await api('/market/my-listings'); }

/* ================= Event wiring ================= */
document.addEventListener('click', (e) => {
  const navBtn = e.target.closest('[data-view]');
  if (navBtn) { showView(navBtn.dataset.view); haptic('light'); }

  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'daily') claimDaily();
  if (action === 'openChestQuick') openChest();
  if (action === 'claimMission') { const next = MISSIONS.find(m => !(user?.missions_done || []).includes(m.id)); if (next) claimMission(next.id); else toast('Barcha vazifalar bajarilgan'); }
  if (action === 'keys') { showView('games'); toast(`Sizda ${user?.keys ?? 0} ta kalit bor`); }

  if (e.target.closest('#dailyChestBanner')) openChest();
  if (e.target.closest('#btnAddDiamond')) toast("To'lov tizimi tez orada qo'shiladi 💎");
  if (e.target.closest('#btnBell')) toast('Bildirishnomalar');

  const missionLi = e.target.closest('[data-mission]');
  if (missionLi && !missionLi.classList.contains('done')) claimMission(missionLi.dataset.mission);

  const buyId = e.target.closest('[data-buy]')?.dataset.buy;
  if (buyId) buyFromShop(Number(buyId));

  const buyListingId = e.target.closest('[data-buylisting]')?.dataset.buylisting;
  if (buyListingId) buyListing(Number(buyListingId));

  const sellBtn = e.target.closest('[data-sellcard]');
  if (sellBtn) sellCard(sellBtn.dataset.sellcard, sellBtn.dataset.price);

  const giftBtn = e.target.closest('[data-giftcard]');
  if (giftBtn) giftCard(giftBtn.dataset.giftcard, giftBtn.dataset.cardname);

  const cancelId = e.target.closest('[data-cancellisting]')?.dataset.cancellisting;
  if (cancelId) cancelListing(Number(cancelId));

  const gameKey = e.target.closest('[data-game]')?.dataset.game;
  if (gameKey) playGame(gameKey);

  // Game modal close
  if (e.target.id === 'gmodal-close' || e.target.closest('#gmodal-close')) closeGameModal();
  if (e.target.id === 'gmodalBackdrop') closeGameModal();

  const filterTab = e.target.closest('[data-filter]');
  if (filterTab) {
    document.querySelectorAll('#cardTabs .tab').forEach(t => t.classList.remove('active'));
    filterTab.classList.add('active');
    cardFilter = filterTab.dataset.filter;
    renderCards();
  }

  const mTab = e.target.closest('[data-mtab]');
  if (mTab) {
    document.querySelectorAll('#marketTabs .tab').forEach(t => t.classList.remove('active'));
    mTab.classList.add('active');
    marketTab = mTab.dataset.mtab;
    renderMarket();
  }
});

document.getElementById('chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text || !ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ text }));
  input.value = '';
});

async function updateProfile(body) {
  try {
    user = await api('/users/me', { method: 'PUT', body: JSON.stringify(body) });
    renderTop();
    toast('Yangilandi!');
  } catch (e) { toast(e.message); }
}

document.getElementById('btnSaveName').addEventListener('click', () => {
  const name = document.getElementById('nameInput').value.trim();
  if (!name) { toast('Ism kiriting'); return; }
  updateProfile({ name });
});

document.getElementById('avatarFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 500_000) { toast("Rasm juda katta — 500KB dan kichik rasm tanlang"); return; }
  const reader = new FileReader();
  reader.onload = () => updateProfile({ avatar_url: reader.result });
  reader.readAsDataURL(file);
});

document.getElementById('btnSettings').addEventListener('click', () => {
  const panel = document.getElementById('settingsPanel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden && user) {
    document.getElementById('toggleNotifications').checked = user.notifications_enabled !== false;
  }
});
document.getElementById('toggleNotifications').addEventListener('change', (e) => {
  updateProfile({ notifications_enabled: e.target.checked });
});
document.getElementById('toggleHaptic').addEventListener('change', (e) => {
  localStorage.setItem('haptic_disabled', e.target.checked ? '0' : '1');
});
(() => {
  const hapticToggle = document.getElementById('toggleHaptic');
  hapticToggle.checked = localStorage.getItem('haptic_disabled') !== '1';
})();

/* ================= Init ================= */
async function init() {
  if (!INIT_DATA) {
    toast('Bu ilova faqat Telegram ichida ishlaydi');
    return;
  }
  try {
    user = await api('/users/me');
    await Promise.all([loadCatalog(), loadMyCards(), loadListings(), loadMyListings()]);
    renderAll();
    showView('home');
    loadFeatured();
  } catch (e) {
    toast('Serverga ulanib bo\'lmadi: ' + e.message);
  }
}
init();
