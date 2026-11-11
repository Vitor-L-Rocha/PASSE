// PASSE — três telas com rotas por hash:
//   #/                início: posição (no campo), lugar, valor esperado e características
//   #/relatorio?...   relatório com abas Nacional / Continental / Global
//   #/jogador/<id>    ficha do jogador

const app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

let meta = null;
const draft = { position: 'ST', country: 'BR', budget: '', selected: [], text: '' };
// Último relatório: dados, aba ativa e rolagem, para voltar da ficha exatamente onde estava.
const report = { hash: null, key: null, data: null, market: null, scrollY: 0 };

const MARKET_NOTE = {
  interno: 'Jogadores de ligas do seu país.',
  externo: 'Jogadores de outras ligas do seu continente.',
  internacional: 'Jogadores de ligas de outros continentes.',
};

// Posições no campo (x: 0 = própria meta, 105 = meta adversária; y: 0-68, esquerda em cima).
const PITCH_SPOTS = {
  GK: ['GOL', 7, 34], CB: ['ZAG', 24, 34], LB: ['LE', 30, 11], RB: ['LD', 30, 57], DM: ['VOL', 41, 34],
  CM: ['MC', 53, 34], AM: ['MEI', 67, 34], LW: ['PE', 80, 11], RW: ['PD', 80, 57], ST: ['CA', 91, 34],
};

// ---------- utilidades ----------
const money = (eur) => {
  if (!Number.isFinite(eur)) return 'sem valor';
  if (eur >= 1e6) return `€ ${(eur / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (eur >= 1e3) return `€ ${Math.round(eur / 1e3).toLocaleString('pt-BR')} mil`;
  return `€ ${eur.toLocaleString('pt-BR')}`;
};
const parseBudget = (s) => Number(String(s).replace(/[^\d]/g, ''));
const countryName = (code) => meta.countries.find((c) => c.code === code)?.name || code || null;
const position = (code) => meta.positions.find((p) => p.code === code);
const positionName = (code) => position(code)?.name || code || '';
const charLabel = (code) => meta.characteristics.find((c) => c.code === code)?.label || code;
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const listPT = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} e ${items.at(-1)}`);
const has = (v) => v !== null && v !== undefined && v !== '';
const dateBR = (d) => (d ? new Date(String(d).slice(0, 10) + 'T00:00').toLocaleDateString('pt-BR') : null);
const sourceName = (s) => ({ tmdata: 'transfermarkt-datasets', demo: 'dados de demonstração (fictícios)' })[s] || s;

const SILHOUETTE = `<svg viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"><path d="M32 8c-7 0-11 5-11 12s4 13 11 13 11-6 11-13S39 8 32 8Z"/><path d="M10 60c1-12 10-20 22-20s21 8 22 20"/></svg>`;
function photo(p) {
  const url = /^https:\/\//.test(p.photoUrl || '') ? p.photoUrl : null;
  return `<span class="photo">${SILHOUETTE}${url ? `<img src="${esc(url)}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()">` : ''}</span>`;
}

// Troca de tela com transição curta quando o navegador permite.
function paint(fn) {
  if (document.startViewTransition && !reduceMotion.matches) document.startViewTransition(fn);
  else fn();
}

// ---------- rotas ----------
function route() {
  const [path, qs] = (location.hash || '#/').slice(1).split('?');
  if (path.startsWith('/jogador/')) return showPlayer(decodeURIComponent(path.slice('/jogador/'.length)));
  if (path === '/relatorio') return showReport(new URLSearchParams(qs || ''));
  return paint(() => { renderHome(); window.scrollTo(0, 0); });
}
window.addEventListener('hashchange', route);

// ---------- campo ----------
function pitchLines(W = 105, H = 68) {
  return `<g class="lines">
    <rect x="0" y="0" width="${W}" height="${H}" />
    <line x1="${W / 2}" y1="0" x2="${W / 2}" y2="${H}" />
    <circle cx="${W / 2}" cy="${H / 2}" r="9.15" />
    <rect x="0" y="${H / 2 - 20.16}" width="16.5" height="40.32" />
    <rect x="${W - 16.5}" y="${H / 2 - 20.16}" width="16.5" height="40.32" />
    <rect x="0" y="${H / 2 - 9.16}" width="5.5" height="18.32" />
    <rect x="${W - 5.5}" y="${H / 2 - 9.16}" width="5.5" height="18.32" />
  </g>`;
}

function positionPitch(selected) {
  const spots = Object.entries(PITCH_SPOTS).map(([code, [short, x, y]]) => `
    <g class="pos-dot" role="radio" tabindex="${code === selected ? 0 : -1}" aria-checked="${code === selected}" data-code="${code}" aria-label="${esc(positionName(code))}">
      <circle cx="${x}" cy="${y}" r="4.6" /><text x="${x}" y="${y}">${short}</text>
    </g>`).join('');
  return `<svg class="pitch" viewBox="-1 -1 107 70" role="radiogroup" aria-label="Posição">
    <rect class="grass" x="0" y="0" width="105" height="68" />${pitchLines()}${spots}</svg>`;
}

// ---------- Tela 1: início ----------
function renderHome() {
  document.title = 'PASSE';
  const byContinent = {};
  for (const c of meta.countries) (byContinent[c.continent] ||= []).push(c);
  app.innerHTML = `
  <section class="home">
    <header class="masthead">
      <h1 class="display">PASSE</h1>
      <p>Plataforma de Auxílio ao Scouting para Sociedades Esportivas</p>
    </header>
    <form class="brief" id="brief" novalidate>
      <div class="col">
        <div class="field">
          <span class="name" id="pos-label">Posição</span>
          <div id="pitch">${positionPitch(draft.position)}</div>
          <span class="position-name" id="pos-name"><b>${esc(positionName(draft.position))}</b></span>
        </div>
        <label class="field">
          <span class="name">Lugar</span>
          <select class="select" name="country">${Object.entries(byContinent).map(([k, list]) => `<optgroup label="${esc(meta.continents[k])}">${list
            .slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
            .map((c) => `<option value="${c.code}" ${c.code === draft.country ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`).join('')}</select>
          <small>País do seu clube. Define o que é mercado nacional, continental e global.</small>
        </label>
      </div>
      <div class="col">
        <label class="field">
          <span class="name">Valor esperado</span>
          <input class="input num" name="budget" type="text" inputmode="numeric" autocomplete="off" placeholder="2.000.000" value="${esc(draft.budget)}" />
          <small id="budget-hint">${draft.budget ? `Até ${money(parseBudget(draft.budget))} de valor de mercado.` : 'Valor de mercado máximo, em euros.'}</small>
        </label>
        <div class="field">
          <span class="name" id="chars-label">Características</span>
          <div class="toggles" id="toggles" role="group" aria-labelledby="chars-label"></div>
          <small id="chars-note"></small>
          <textarea class="input" name="text" rows="3" maxlength="1000" aria-label="Descrição do jogador" placeholder="Descreva o jogador. Pé, idade e altura viram filtros: canhoto, até 23 anos, acima de 1,80.">${esc(draft.text)}</textarea>
        </div>
      </div>
      <div class="submit-row">
        <p class="error" id="form-error" role="alert"></p>
        <button class="btn" type="submit">Gerar relatório</button>
      </div>
    </form>
  </section>`;

  const form = document.getElementById('brief');
  const pitch = document.getElementById('pitch');

  const renderToggles = () => {
    const group = position(draft.position)?.group;
    const forPos = meta.characteristics.filter((c) => c.positions.includes(group));
    const usable = forPos.filter((c) => c.available);
    const missing = forPos.filter((c) => !c.available);
    draft.selected = draft.selected.filter((code) => usable.some((c) => c.code === code));
    document.getElementById('toggles').innerHTML = usable
      .map((c) => `<button type="button" class="toggle" data-code="${c.code}" aria-pressed="${draft.selected.includes(c.code)}">${esc(c.label)}</button>`)
      .join('');
    document.getElementById('chars-note').textContent = missing.length
      ? `${usable.length ? `Com os dados atuais dá para avaliar ${listPT(usable.map((c) => lower(c.label)))}.` : 'Os dados atuais não permitem avaliar características desta posição.'} ${missing.slice(0, 3).map((c) => c.label).map((l, i) => (i ? lower(l) : l)).join(', ')}${missing.length > 3 ? ' e outras' : ''} dependem de estatísticas mais detalhadas${meta.sources?.some((x) => x.info?.recentPlayers) ? '' : ' (configure a API-Football para liberar mais características)'}.`
      : '';
  };
  renderToggles();

  const choose = (code, focus) => {
    draft.position = code;
    pitch.innerHTML = positionPitch(code);
    document.getElementById('pos-name').innerHTML = `<b>${esc(positionName(code))}</b>`;
    renderToggles();
    if (focus) pitch.querySelector(`[data-code="${code}"]`)?.focus();
  };
  pitch.addEventListener('click', (e) => {
    const dot = e.target.closest('.pos-dot');
    if (dot) choose(dot.dataset.code, true);
  });
  pitch.addEventListener('keydown', (e) => {
    const codes = Object.keys(PITCH_SPOTS);
    const i = codes.indexOf(draft.position);
    if (['ArrowRight', 'ArrowDown'].includes(e.key)) { e.preventDefault(); choose(codes[(i + 1) % codes.length], true); }
    if (['ArrowLeft', 'ArrowUp'].includes(e.key)) { e.preventDefault(); choose(codes[(i - 1 + codes.length) % codes.length], true); }
    if ([' ', 'Enter'].includes(e.key) && e.target.closest('.pos-dot')) { e.preventDefault(); choose(e.target.closest('.pos-dot').dataset.code, true); }
  });

  form.country.addEventListener('change', () => { draft.country = form.country.value; });
  form.text.addEventListener('input', () => { draft.text = form.text.value; });
  form.budget.addEventListener('input', () => {
    const n = parseBudget(form.budget.value);
    form.budget.value = n ? n.toLocaleString('pt-BR') : '';
    draft.budget = form.budget.value;
    document.getElementById('budget-hint').textContent = n ? `Até ${money(n)} de valor de mercado.` : 'Valor de mercado máximo, em euros.';
  });
  document.getElementById('toggles').addEventListener('click', (e) => {
    const b = e.target.closest('.toggle');
    if (!b) return;
    const i = draft.selected.indexOf(b.dataset.code);
    if (i >= 0) draft.selected.splice(i, 1); else draft.selected.push(b.dataset.code);
    b.setAttribute('aria-pressed', String(i < 0));
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const budget = parseBudget(form.budget.value);
    if (!budget) {
      document.getElementById('form-error').textContent = 'Informe o valor esperado para gerar o relatório.';
      form.budget.focus();
      return;
    }
    const q = new URLSearchParams({ pais: form.country.value, posicao: draft.position, teto: String(budget) });
    if (draft.selected.length) q.set('car', draft.selected.join(','));
    if (form.text.value.trim()) q.set('desc', form.text.value.trim());
    location.hash = `#/relatorio?${q}`;
  });
}

// ---------- Tela 2: relatório ----------
async function showReport(params) {
  const body = {
    country: params.get('pais'),
    position: params.get('posicao'),
    maxBudgetEur: Number(params.get('teto')),
    selectedCharacteristics: (params.get('car') || '').split(',').filter(Boolean),
    characteristics: params.get('desc') || '',
  };
  Object.assign(draft, {
    country: body.country || draft.country,
    position: body.position || draft.position,
    budget: body.maxBudgetEur ? body.maxBudgetEur.toLocaleString('pt-BR') : draft.budget,
    selected: [...body.selectedCharacteristics],
    text: body.characteristics,
  });
  const key = JSON.stringify(body);
  const returning = report.key === key && report.data;
  if (!returning) {
    paint(() => { app.innerHTML = `<p class="loading">Montando o relatório…</p>`; window.scrollTo(0, 0); });
    try {
      const res = await fetch('/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error((data.errors || ['Não foi possível gerar o relatório.']).join(' '));
      Object.assign(report, { key, data, scrollY: 0, market: Object.keys(meta.markets).find((k) => data.markets[k].length) || 'interno' });
    } catch (ex) {
      app.innerHTML = `<section class="player"><p class="error">${esc(ex.message)}</p><p><a class="btn line" href="#/">Voltar ao início</a></p></section>`;
      return;
    }
  }
  report.hash = location.hash;
  paint(() => {
    renderReport();
    window.scrollTo(0, returning ? report.scrollY : 0);
  });
}

function renderReport() {
  const d = report.data;
  document.title = 'Relatório · PASSE';
  const f = d.criteria.filters;
  const filters = [f.foot && `pé ${f.foot}`, f.maxAge && `até ${f.maxAge} anos`, f.minAge && `${f.minAge} anos ou mais`, f.minHeightCm && `${f.minHeightCm} cm ou mais`].filter(Boolean);
  const notices = [];
  if (d.providers.includes('demo')) notices.push('Estes são jogadores fictícios de demonstração. Rode npm run sync-data para usar dados reais.');
  for (const pe of d.providerErrors || []) notices.push(`A fonte ${sourceName(pe.provider)} não respondeu: ${pe.message}`);
  notices.push(...(d.criteria.warnings || []));
  if (d.ignored?.length) notices.push(`${listPT(d.ignored.map(charLabel))} não ${d.ignored.length > 1 ? 'entraram' : 'entrou'} na busca: a fonte atual não tem estatísticas para avaliar.`);
  if (d.usingPositionProfile) {
    notices.push(d.desired.length
      ? `Sem características escolhidas, o relatório usa o perfil típico de ${lower(positionName(d.query.position))}: ${listPT(d.desired.map((c) => lower(charLabel(c))))}.`
      : 'Sem características avaliáveis para esta posição, a lista prioriza quem mais jogou na temporada.');
  } else if (!d.desired.length) {
    notices.push('Nenhuma das características pedidas pode ser avaliada com a fonte atual. A lista mostra todos dentro do valor esperado, priorizando quem mais jogou.');
  }
  const source = meta.sources?.[0];

  app.innerHTML = `
  <section class="report">
    <aside class="sidebar">
      <a class="logo display" href="#/">PASSE</a>
      <dl>
        <div><dt>Posição</dt><dd>${esc(positionName(d.query.position))}</dd></div>
        <div><dt>Lugar</dt><dd>${esc(countryName(d.query.country))}</dd></div>
        <div><dt>Valor esperado</dt><dd>Até ${money(d.query.maxBudgetEur)}</dd></div>
        <div><dt>Características</dt><dd>${d.desired.length ? `<span class="wanted">${d.desired.map((c) => `<span>${esc(charLabel(c))}</span>`).join('')}</span>` : 'Nenhuma'}</dd></div>
        ${filters.length ? `<div><dt>Filtros</dt><dd>${esc(listPT(filters))}</dd></div>` : ''}
        ${d.criteria.text ? `<div><dt>Descrição</dt><dd>“${esc(d.criteria.text)}”</dd></div>` : ''}
      </dl>
      <a class="btn" href="#/">Alterar busca</a>
      ${source ? `<p class="source">Dados: ${esc(source.info?.name || source.label)}${source.info?.license ? `, licença ${esc(source.info.license)}` : ''}.${source.info?.recentPlayers ? ` ${source.info.recentPlayers.toLocaleString('pt-BR')} jogadores com temporada atual pela API-Football.` : ''}</p>` : ''}
    </aside>
    <div class="board">
      <header>
        <h1 class="display">Seu relatório foi feito</h1>
        <p class="lede">${d.total.toLocaleString('pt-BR')} jogadores dentro do valor esperado e dos filtros.</p>
      </header>
      ${notices.length ? `<div class="notices">${notices.map((n) => `<p class="notice">${esc(n)}</p>`).join('')}</div>` : ''}
      <div class="tabs" role="tablist">
        ${Object.entries(meta.markets).map(([k, label]) => `
          <button class="tab" role="tab" id="tab-${k}" aria-controls="roster" data-market="${k}" aria-selected="${k === report.market}">
            <span class="t">${esc(label)}</span><span class="c">${countLabel(d, k)}</span>
          </button>`).join('')}
      </div>
      <p class="tab-note" id="tab-note"></p>
      <ol class="roster" id="roster" role="tabpanel"></ol>
    </div>
  </section>`;

  const drawRoster = () => {
    const list = d.markets[report.market];
    document.getElementById('tab-note').textContent = MARKET_NOTE[report.market];
    document.getElementById('roster').setAttribute('aria-labelledby', `tab-${report.market}`);
    document.getElementById('roster').innerHTML = list.length
      ? list.map(rosterRow).join('')
      : `<li class="empty-state">Ninguém neste mercado com esses critérios. Aumente o valor esperado ou troque as características.</li>`;
  };
  drawRoster();

  app.querySelector('.tabs').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (!t || t.dataset.market === report.market) return;
    report.market = t.dataset.market;
    for (const b of app.querySelectorAll('.tab')) b.setAttribute('aria-selected', String(b === t));
    paint(drawRoster);
  });
  document.getElementById('roster').addEventListener('click', (e) => {
    const r = e.target.closest('.row');
    if (!r) return;
    report.scrollY = window.scrollY;
    location.hash = `#/jogador/${encodeURIComponent(r.dataset.id)}`;
  });
}

function countLabel(d, k) {
  const total = d.marketTotals?.[k] ?? d.markets[k].length;
  const shown = d.markets[k].length;
  return shown < total ? `${shown} de ${total.toLocaleString('pt-BR')} jogadores` : `${total} jogador${total === 1 ? '' : 'es'}`;
}

function rosterRow(p) {
  const m = p.match || { matched: [], weakIn: [], desiredCount: 0 };
  const where = [p.club, [p.league, countryName(p.leagueCountry)].filter(Boolean).join(', ')].filter(Boolean).join(', ');
  const who = [Number.isFinite(p.age) && `${p.age} anos`, p.foot && `pé ${p.foot}`].filter(Boolean).join(', ');
  let fit;
  if (m.noData) {
    fit = p.characteristics?.source === 'indisponivel'
      ? '<span class="quiet">Sem dados de desempenho nesta fonte.</span>'
      : '<span class="quiet">Os dados deste jogador não cobrem as características pedidas.</span>';
  }
  else if (m.desiredCount) {
    fit = m.matched.length
      ? `Atende <b>${esc(listPT(m.matched.map((c) => lower(charLabel(c)))))}</b>${m.matched.length < m.desiredCount ? ` (${m.matched.length} de ${m.desiredCount})` : ''}.`
      : 'Não se destaca nas características pedidas.';
    if (m.weakIn.length) fit += ` <span class="quiet">Ponto fraco: ${esc(listPT(m.weakIn.map((c) => lower(charLabel(c)))))}.</span>`;
  } else fit = '';
  return `
  <li><button class="row${m.noData ? ' nodata' : ''}" data-id="${esc(p.id)}">
    ${photo(p)}
    <span>
      <span class="name">${esc(p.name)}</span>
      <span class="where">${esc(where)}${who ? `. ${esc(who)}` : ''}</span>
      ${fit ? `<span class="fit">${fit}</span>` : ''}
    </span>
    <span class="value num">${money(p.marketValueEur)}<small>${Number.isFinite(p.minutes) ? `${p.minutes.toLocaleString('pt-BR')} min em ${esc(p.season)}` : Number.isFinite(p.appearances) && p.season ? `${p.appearances} jogos em ${esc(p.season)}` : 'valor de mercado'}</small></span>
  </button></li>`;
}

// ---------- Tela 3: jogador ----------
async function showPlayer(id) {
  let p;
  try {
    const res = await fetch(`/api/players/${encodeURIComponent(id)}`);
    p = await res.json();
    if (!res.ok) throw new Error((p.errors || ['Jogador não encontrado.']).join(' '));
  } catch (ex) {
    app.innerHTML = `<section class="player"><p class="error">${esc(ex.message)}</p><p><a class="btn line" href="${esc(report.hash || '#/')}">Voltar</a></p></section>`;
    return;
  }
  paint(() => { renderPlayer(p); window.scrollTo(0, 0); });
}

function renderPlayer(p) {
  document.title = `${p.name} · PASSE`;
  const inReport = report.data && Object.values(report.data.markets).flat().find((x) => x.id === p.id);
  const desired = report.data?.desired || [];
  const chars = p.characteristics || { positive: [], negative: [], source: 'indisponivel' };
  const seasons = (p.seasons || []).slice();
  const hasRating = seasons.some((s) => Number.isFinite(s.rating));
  const links = Object.entries(p.links || {}).filter(([, url]) => /^https?:\/\//.test(url));
  const fact = (label, value) => (has(value) ? `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>` : '');

  app.innerHTML = `
  <section class="player">
    <nav class="player-bar">
      <a class="logo display" href="#/">PASSE</a>
      ${report.hash ? `<a class="btn line small" href="${esc(report.hash)}">Voltar ao relatório</a>` : ''}
    </nav>
    <header class="hero">
      ${photo(p)}
      <div>
        <h1 class="display">${esc(p.name)}</h1>
        <dl class="facts">
          ${fact('Idade', Number.isFinite(p.age) ? `${p.age} anos` : null)}
          ${fact('Time', p.club)}
          ${fact('Posição', positionName(p.position))}
          ${fact('Pé', p.foot)}
        </dl>
        <dl class="facts secondary">
          ${fact('Valor de mercado', Number.isFinite(p.marketValueEur) ? money(p.marketValueEur) : null)}
          ${fact('Liga', [p.league, countryName(p.leagueCountry)].filter(Boolean).join(', '))}
          ${fact('Nacionalidade', countryName(p.nationality))}
          ${fact('Altura', Number.isFinite(p.heightCm) ? `${(p.heightCm / 100).toFixed(2).replace('.', ',')} m` : null)}
          ${fact('Contrato até', dateBR(p.contractUntil))}
          ${inReport ? fact('Mercado', meta.markets[inReport.market]) : ''}
        </dl>
      </div>
    </header>

    <div class="sheet">
      <section>
        <h2 class="display">Mapa de calor</h2>
        ${heatmap(p.heatmap)}
      </section>
      <section>
        <h2 class="display">Time e estatística por temporada</h2>
        ${seasons.length ? `<div class="table-wrap"><table class="seasons">
          <thead><tr><th>Temporada</th><th>Time</th><th class="n">Jogos</th><th class="n">Min</th><th class="n">Gols</th><th class="n">Assist.</th>${hasRating ? '<th class="n">Nota*</th>' : ''}</tr></thead>
          <tbody>${seasons.map((s) => `<tr>
            <td class="num">${esc(s.season)}</td>
            <td>${esc(s.club || '')}${s.league ? `<small>${esc(s.league)}</small>` : ''}</td>
            <td class="n">${has(s.appearances) ? s.appearances : ''}</td>
            <td class="n">${Number.isFinite(s.minutes) ? s.minutes.toLocaleString('pt-BR') : ''}</td>
            <td class="n">${has(s.goals) ? s.goals : ''}</td>
            <td class="n">${has(s.assists) ? s.assists : ''}</td>
            ${hasRating ? `<td class="n">${Number.isFinite(s.rating) ? s.rating.toFixed(2).replace('.', ',') : ''}</td>` : ''}
          </tr>`).join('')}</tbody></table></div>
          ${hasRating ? `<p class="src">* Nota média dada pela fonte, não pelo PASSE.</p>` : ''}`
        : `<p class="unavailable">A fonte não tem partidas registradas deste jogador nas últimas temporadas.</p>`}
      </section>
      <section>
        <h2 class="display">Títulos</h2>
        ${Array.isArray(p.titles) && p.titles.length
          ? `<ul class="titles">${p.titles.map((t) => `<li><span class="num">${esc(t.season || '')}</span><span>${esc(t.name)}${t.club ? `<br><span class="quiet">${esc(t.club)}</span>` : ''}</span></li>`).join('')}</ul>
             ${p.titlesSource ? `<p class="src">Fonte dos títulos: ${esc(p.titlesSource)}.</p>` : ''}`
          : `<p class="unavailable">${Array.isArray(p.titles) ? 'Nenhum título conquistado registrado na fonte.' : 'Títulos disponíveis para jogadores atualizados pela API-Football (configure a chave e rode npm run sync-apifootball).'}</p>`}
      </section>
      <section>
        <h2 class="display">Características</h2>
        ${chars.source === 'indisponivel'
          ? `<p class="unavailable">Sem estatísticas suficientes para apontar pontos fortes ou fracos deste jogador.</p>`
          : `<div class="chars"><h3>Pontos fortes</h3><div class="marks">${chars.positive.length ? chars.positive.map((c) => `<span class="mark${desired.includes(c) ? ' hit' : ''}">${esc(charLabel(c))}</span>`).join('') : '<span class="quiet">Nenhum destaque nas estatísticas disponíveis.</span>'}</div></div>
             <div class="chars"><h3>Pontos fracos</h3><div class="marks">${chars.negative.length ? chars.negative.map((c) => `<span class="mark weak">${esc(charLabel(c))}</span>`).join('') : '<span class="quiet">Nenhum apontado.</span>'}</div></div>
             <p class="src">${chars.source === 'estatisticas'
               ? `Deduzidas ${p.recent ? `das estatísticas da ${esc(p.recent.source)}` : 'de gols e assistências'} ${p.perGame ? 'por jogo (a fonte não informa minutos)' : 'por 90 minutos'}${Number.isFinite(p.minutes) ? ` (${p.minutes.toLocaleString('pt-BR')} min em ${esc(p.season)})` : Number.isFinite(p.appearances) && p.season ? ` (${p.appearances} jogos em ${esc(p.season)})` : ''}, comparadas a jogadores da mesma função.`
               : 'Informadas pela fonte.'}${desired.length ? ' Em preto, as que você procurou.' : ''}</p>`}
      </section>
    </div>

    <footer class="colophon">
      <span>Perfil, valor e contrato: ${esc(sourceName(p.source))}.</span>
      ${p.recent ? (p.recent.current === false
        ? `<span>Temporada ${esc(p.recent.season)} e títulos: ${esc(p.recent.source)} (plano grátis libera até ${esc(p.recent.season)}; clube atual vem do perfil).</span>`
        : `<span>Clube, jogos e estatísticas de ${esc(p.recent.season)}: ${esc(p.recent.source)}${p.recent.fetchedAt ? `, atualizado em ${esc(dateBR(p.recent.fetchedAt))}` : ''}.</span>`) : ''}
      ${links.map(([k, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener">Perfil no ${esc(k === 'transfermarkt' ? 'Transfermarkt' : k === 'sofascore' ? 'SofaScore' : k)}</a>`).join('')}
    </footer>
  </section>`;
}

function heatmap(h) {
  const pts = h?.points || [];
  if (!pts.length) return `<p class="unavailable">A fonte atual não fornece mapa de calor.</p>`;
  const max = Math.max(...pts.map((p) => p.count || 1));
  const dots = pts.map((p) => `<circle cx="${(p.x / 100) * 105}" cy="${(p.y / 100) * 68}" r="5" fill="#000" fill-opacity="${(0.1 + 0.2 * ((p.count || 1) / max)).toFixed(3)}" />`).join('');
  return `<svg class="pitch" viewBox="-1 -1 107 70" role="img" aria-label="Mapa de calor do jogador; o time ataca para a direita">
    <defs><filter id="blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.6" /></filter><clipPath id="field"><rect width="105" height="68" /></clipPath></defs>
    <rect class="grass" x="0" y="0" width="105" height="68" />
    <g filter="url(#blur)" clip-path="url(#field)">${dots}</g>${pitchLines()}
  </svg>
  <p class="src">${esc([h.competition, h.season].filter(Boolean).join(', '))}${h.competition || h.season ? '. ' : ''}O time ataca para a direita.</p>`;
}

// ---------- início ----------
(async function init() {
  try {
    meta = await (await fetch('/api/meta')).json();
    route();
  } catch (e) {
    app.innerHTML = `<p class="loading">Não foi possível carregar o PASSE: ${esc(e.message)}</p>`;
  }
})();
