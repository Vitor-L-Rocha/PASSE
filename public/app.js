// PASSE — frontend em 3 telas (rotas por hash):
//   #/                    início: posição, lugar, valor esperado e características
//   #/relatorio?...       relatório com abas Nacional / Continental / Global
//   #/jogador/<id>        ficha do jogador (mapa de calor, temporadas, títulos, características)

const app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let meta = null;
let lastReportHash = '#/';
let lastReport = null; // { key, data }
let activeMarket = null;
const draft = { position: 'ST', country: 'BR', budget: '', selected: [], text: '' };

const MARKET_HINT = {
  interno: 'Jogam em ligas do seu país',
  externo: 'Outras ligas do seu continente',
  internacional: 'Ligas de outros continentes',
};

// ---------- utilidades ----------
const money = (eur) => {
  if (!Number.isFinite(eur)) return '—';
  if (eur >= 1e6) return `€ ${(eur / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi`;
  if (eur >= 1e3) return `€ ${Math.round(eur / 1e3).toLocaleString('pt-BR')} mil`;
  return `€ ${eur.toLocaleString('pt-BR')}`;
};
const parseBudget = (s) => Number(String(s).replace(/[^\d]/g, ''));
const countryName = (code) => meta.countries.find((c) => c.code === code)?.name || code || '—';
const position = (code) => meta.positions.find((p) => p.code === code);
const positionName = (code) => position(code)?.name || code || '—';
const charLabel = (code) => meta.characteristics.find((c) => c.code === code)?.label || code;
const orDash = (v) => (v === null || v === undefined || v === '' ? '—' : v);
const ageText = (a) => (Number.isFinite(a) ? `${a} anos` : '—');
const dateBR = (d) => (d ? new Date(String(d).slice(0, 10) + 'T00:00').toLocaleDateString('pt-BR') : '—');

const SILHOUETTE = `<svg viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round">
  <path d="M32 8c-7 0-11 5-11 12s4 13 11 13 11-6 11-13S39 8 32 8Z"/><path d="M10 58c1-12 10-19 22-19s21 7 22 19"/></svg>`;

// Silhueta sempre por baixo; se a foto existir e carregar, ela cobre a silhueta.
function photo(p) {
  const url = /^https?:\/\//.test(p.photoUrl || '') ? p.photoUrl : null;
  return `<div class="photo">${SILHOUETTE}${url ? `<img src="${esc(url)}" alt="Foto de ${esc(p.name)}" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()">` : ''}</div>`;
}

// ---------- roteamento ----------
function route() {
  const hash = location.hash || '#/';
  const [path, qs] = hash.slice(1).split('?');
  window.scrollTo(0, 0);
  if (path.startsWith('/jogador/')) return renderPlayer(decodeURIComponent(path.slice('/jogador/'.length)));
  if (path === '/relatorio') return renderReport(new URLSearchParams(qs || ''));
  return renderHome();
}
window.addEventListener('hashchange', route);

// ---------- Tela 1: início ----------
function renderHome() {
  document.title = 'PASSE';
  const byContinent = {};
  for (const c of meta.countries) (byContinent[c.continent] ||= []).push(c);
  app.innerHTML = `
  <section class="home">
    <form class="box home-card" id="search" novalidate>
      <h1 class="wordmark">PASSE</h1>
      <p class="subtitle">Plataforma de Auxílio ao Scouting para Sociedades Esportivas</p>
      <div class="home-grid">
        <div class="col">
          <label class="box field">
            <span class="label">Posição</span>
            <select name="position">${meta.positions.map((p) => `<option value="${p.code}" ${p.code === draft.position ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
          </label>
            <label class="box field">
            <span class="label">Lugar · país do seu clube</span>
            <select name="country">${Object.entries(byContinent).map(([k, list]) => `<optgroup label="${esc(meta.continents[k])}">${list
              .slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
              .map((c) => `<option value="${c.code}" ${c.code === draft.country ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`).join('')}</select>
          </label>
          </div>
        <div class="col">
          <label class="box field">
            <span class="label">Valor esperado · teto (€)</span>
            <input name="budget" type="text" inputmode="numeric" placeholder="ex.: 2.000.000" value="${esc(draft.budget)}" />
            <small id="budgetHint">${draft.budget ? `Até ${money(parseBudget(draft.budget))}` : 'Valor de mercado máximo do atleta'}</small>
          </label>
            <div class="box field">
            <span class="label" id="chars-label">Seleção e descrição de características</span>
            <div class="chips" id="chips" role="group" aria-labelledby="chars-label"></div>
            <textarea name="text" rows="3" maxlength="1000" placeholder="Descreva o jogador: ex. canhoto, rápido, jovem até 23 anos, acima de 1,80">${esc(draft.text)}</textarea>
            <small>Pé, idade e altura escritos aqui viram filtros.</small>
          </div>
          </div>
      </div>
      <div class="home-actions">
        <p class="error" id="formError" role="alert"></p>
        <button class="btn" type="submit">Gerar relatório</button>
      </div>
    </form>
  </section>`;

  const form = document.getElementById('search');
  const renderChips = () => {
    const group = position(form.position.value)?.group;
    const list = meta.characteristics.filter((c) => c.positions.includes(group));
    draft.selected = draft.selected.filter((code) => list.some((c) => c.code === code));
    document.getElementById('chips').innerHTML = list
      .map((c) => `<button type="button" class="chip" data-code="${c.code}" aria-pressed="${draft.selected.includes(c.code)}">${esc(c.label)}</button>`)
      .join('');
  };
  renderChips();
  form.position.addEventListener('change', () => { draft.position = form.position.value; renderChips(); });
  form.country.addEventListener('change', () => { draft.country = form.country.value; });
  form.text.addEventListener('input', () => { draft.text = form.text.value; });
  form.budget.addEventListener('input', () => {
    const n = parseBudget(form.budget.value);
    form.budget.value = n ? n.toLocaleString('pt-BR') : '';
    draft.budget = form.budget.value;
    document.getElementById('budgetHint').textContent = n ? `Até ${money(n)}` : 'Valor de mercado máximo do atleta';
  });
  document.getElementById('chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const code = b.dataset.code;
    const i = draft.selected.indexOf(code);
    if (i >= 0) draft.selected.splice(i, 1);
    else draft.selected.push(code);
    b.setAttribute('aria-pressed', String(i < 0));
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const budget = parseBudget(form.budget.value);
    const err = document.getElementById('formError');
    if (!budget) {
      err.textContent = 'Informe o valor esperado (teto em euros).';
      form.budget.focus();
      return;
    }
    const q = new URLSearchParams({ pais: form.country.value, posicao: form.position.value, teto: String(budget) });
    if (draft.selected.length) q.set('car', draft.selected.join(','));
    if (form.text.value.trim()) q.set('desc', form.text.value.trim());
    activeMarket = null;
    location.hash = `#/relatorio?${q}`;
  });
}

// ---------- Tela 2: relatório ----------
async function renderReport(params) {
  document.title = 'Relatório · PASSE';
  lastReportHash = location.hash;
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
  let data = lastReport?.key === key ? lastReport.data : null;
  if (!data) {
    app.innerHTML = `<div class="loading">Consultando fontes e montando o relatório…</div>`;
    try {
      const res = await fetch('/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      data = await res.json();
      if (!res.ok) throw new Error((data.errors || ['Erro na busca.']).join(' '));
      lastReport = { key, data };
    } catch (ex) {
      app.innerHTML = `<section class="player"><div class="box empty"><p class="error">${esc(ex.message)}</p><a class="btn ghost" href="#/">Voltar ao início</a></div></section>`;
      return;
    }
  }
  if (!activeMarket) activeMarket = Object.keys(meta.markets).find((k) => data.markets[k].length) || 'interno';
  drawReport(data);
}

function drawReport(d) {
  const f = d.criteria.filters;
  const filters = [
    f.foot && `Pé ${f.foot}`,
    f.maxAge && `Até ${f.maxAge} anos`,
    f.minAge && `${f.minAge}+ anos`,
    f.minHeightCm && `${f.minHeightCm}+ cm`,
  ].filter(Boolean);
  const notes = [];
  if (d.providers.length === 1 && d.providers[0] === 'demo') notes.push('Dados de demonstração: jogadores e clubes fictícios. Configure as fontes reais para o mercado de verdade.');
  for (const pe of d.providerErrors || []) notes.push(`Fonte "${pe.provider}" indisponível: ${pe.message}`);
  notes.push(...(d.criteria.warnings || []));
  if (d.usingPositionProfile) notes.push(`Nenhuma característica escolhida: usamos o perfil típico de ${positionName(d.query.position).toLowerCase()} (${d.desired.map(charLabel).join(', ')}).`);

  const list = d.markets[activeMarket];
  app.innerHTML = `
  <section class="report">
    <aside class="side">
      <a class="logo" href="#/">PASSE</a>
      <h2>Resumo das escolhas</h2>
      <dl>
        <div><dt>Posição</dt><dd>${esc(positionName(d.query.position))}</dd></div>
        <div><dt>Lugar</dt><dd>${esc(countryName(d.query.country))}</dd></div>
        <div><dt>Valor esperado</dt><dd>até ${money(d.query.maxBudgetEur)}</dd></div>
        <div><dt>Características</dt><dd>${d.desired.length ? d.desired.map((c) => `<span class="tag">${esc(charLabel(c))}</span>`).join('') : '—'}</dd></div>
        ${filters.length ? `<div><dt>Filtros</dt><dd>${filters.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</dd></div>` : ''}
        ${d.criteria.text ? `<div><dt>Descrição</dt><dd>“${esc(d.criteria.text)}”</dd></div>` : ''}
      </dl>
      <a class="btn" href="#/">Editar busca</a>
    </aside>
    <div class="main">
      <div class="box banner">
        <h1>Seu relatório foi feito</h1>
        <span class="label">${d.total} jogador${d.total === 1 ? '' : 'es'} no perfil</span>
      </div>
      ${notes.map((n) => `<div class="note">${esc(n)}</div>`).join('')}
      <div class="tabs" role="tablist">
        ${Object.entries(meta.markets).map(([k, label]) => `
          <button class="tab" role="tab" data-market="${k}" aria-selected="${k === activeMarket}">
            <span><strong>${esc(label)}</strong><small>${esc(MARKET_HINT[k])}</small></span>
            <span class="count">${d.markets[k].length}</span>
          </button>`).join('')}
      </div>
      <div class="cards" role="tabpanel">
        ${list.length ? list.map(playerCard).join('') : `<div class="box empty">Nenhum jogador neste mercado com esses critérios. Tente aumentar o valor esperado ou escolher outras características.</div>`}
      </div>
      <p class="foot-note">Ordenado por encaixe nas características pedidas, não por qualidade geral. Mercado definido pela liga em que o atleta joga.</p>
    </div>
  </section>`;

  app.querySelector('.tabs').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (!t) return;
    activeMarket = t.dataset.market;
    drawReport(d);
  });
  app.querySelector('.cards').addEventListener('click', (e) => {
    const c = e.target.closest('.pcard');
    if (c) location.hash = `#/jogador/${encodeURIComponent(c.dataset.id)}`;
  });
}

function playerCard(p) {
  const m = p.match || { matched: [], weakIn: [], desiredCount: 0 };
  const others = (p.characteristics?.positive || []).filter((c) => !m.matched.includes(c)).slice(0, 3);
  return `
  <button class="box pcard" data-id="${esc(p.id)}">
    ${photo(p)}
    <div>
      <div class="pos">${esc(positionName(p.position))} · ${esc(countryName(p.leagueCountry))}</div>
      <h3>${esc(p.name)}</h3>
      <div class="meta">${esc(ageText(p.age))} · ${esc(orDash(p.club))} · pé ${esc(orDash(p.foot))}</div>
      <div class="fit">Atende ${m.matched.length} de ${m.desiredCount} característica${m.desiredCount === 1 ? '' : 's'}</div>
      <div class="chips">
        ${m.matched.map((c) => `<span class="tag">${esc(charLabel(c))}</span>`).join('')}
        ${others.map((c) => `<span class="tag outline">${esc(charLabel(c))}</span>`).join('')}
        ${m.weakIn.map((c) => `<span class="tag weak">ponto fraco: ${esc(charLabel(c))}</span>`).join('')}
      </div>
    </div>
    <div class="right">
      <span class="value">${money(p.marketValueEur)}</span>
      <span class="go">Ver jogador →</span>
    </div>
  </button>`;
}

// ---------- Tela 3: jogador ----------
async function renderPlayer(id) {
  app.innerHTML = `<div class="loading">Carregando jogador…</div>`;
  let p;
  try {
    const res = await fetch(`/api/players/${encodeURIComponent(id)}`);
    p = await res.json();
    if (!res.ok) throw new Error((p.errors || ['Jogador não encontrado.']).join(' '));
  } catch (ex) {
    app.innerHTML = `<section class="player"><div class="box empty"><p class="error">${esc(ex.message)}</p><a class="btn ghost" href="${esc(lastReportHash)}">Voltar</a></div></section>`;
    return;
  }
  document.title = `${p.name} · PASSE`;
  const summary = lastReport && Object.values(lastReport.data.markets).flat().find((x) => x.id === p.id);
  const chars = p.characteristics || { positive: [], negative: [] };
  const desired = lastReport?.data.desired || [];
  const seasons = (p.seasons || []).slice().sort((a, b) => String(b.season).localeCompare(String(a.season)));
  const links = Object.entries(p.links || {}).filter(([, url]) => /^https?:\/\//.test(url));
  const hasRating = seasons.some((s) => Number.isFinite(s.rating));

  app.innerHTML = `
  <section class="player">
    <div class="player-top">
      <a class="logo" href="#/">PASSE</a>
      <a class="btn ghost small" href="${esc(lastReportHash)}">← Voltar ao relatório</a>
    </div>
    <article class="box sheet">
      <header class="ident">
        ${photo(p)}
        <div>
          <h1>${esc(p.name)}</h1>
          <dl class="facts">
            <dt>Idade</dt><dd>${esc(ageText(p.age))}</dd>
            <dt>Time</dt><dd>${esc(orDash(p.club))}</dd>
            <dt>Posição</dt><dd>${esc(positionName(p.position))}</dd>
            <dt>Pé</dt><dd>${esc(orDash(p.foot))}</dd>
          </dl>
        </div>
      </header>
      <div class="kpis">
        <span class="kpi"><span>Valor</span>${money(p.marketValueEur)}</span>
        <span class="kpi"><span>Liga</span>${esc(orDash(p.league))} (${esc(countryName(p.leagueCountry))})</span>
        <span class="kpi"><span>Nacionalidade</span>${esc(countryName(p.nationality))}</span>
        <span class="kpi"><span>Altura</span>${Number.isFinite(p.heightCm) ? `${(p.heightCm / 100).toFixed(2).replace('.', ',')} m` : '—'}</span>
        <span class="kpi"><span>Contrato até</span>${dateBR(p.contractUntil)}</span>
        ${summary ? `<span class="kpi"><span>Mercado</span>${esc(meta.markets[summary.market])}</span>` : ''}
      </div>
      <div class="sheet-grid">
        <section class="box panel">
          <h2>Mapa de calor</h2>
          ${heatmap(p.heatmap)}
        </section>
        <section class="box panel">
          <h2>Time e estatística por temporada</h2>
          ${seasons.length ? `<div class="table-wrap"><table class="seasons">
            <thead><tr><th>Temp.</th><th>Time</th><th class="n">J</th><th class="n">Min</th><th class="n">G</th><th class="n">A</th>${hasRating ? '<th class="n">Nota*</th>' : ''}</tr></thead>
            <tbody>${seasons.map((s) => `<tr>
              <td class="mono">${esc(s.season)}</td>
              <td>${esc(orDash(s.club))}<br><small class="label">${esc(orDash(s.league))}</small></td>
              <td class="n">${esc(orDash(s.appearances))}</td>
              <td class="n">${Number.isFinite(s.minutes) ? s.minutes.toLocaleString('pt-BR') : '—'}</td>
              <td class="n">${esc(orDash(s.goals))}</td>
              <td class="n">${esc(orDash(s.assists))}</td>
              ${hasRating ? `<td class="n">${Number.isFinite(s.rating) ? s.rating.toFixed(2).replace('.', ',') : '—'}</td>` : ''}
            </tr>`).join('')}</tbody></table></div>
            ${hasRating ? `<p class="sub">* Nota média atribuída pela fonte (${esc(p.source)}), não pelo PASSE.</p>` : ''}`
          : '<p class="sub">A fonte não informou o histórico por temporada.</p>'}
        </section>
        <section class="box panel">
          <h2>Títulos</h2>
          ${(p.titles || []).length ? `<ul class="titles">${p.titles.map((t) => `<li><span class="yr">${esc(t.season)}</span><span>${esc(t.name)}<small>${esc(orDash(t.club))}</small></span></li>`).join('')}</ul>` : '<p class="sub">Nenhum título informado pela fonte.</p>'}
        </section>
        <section class="box panel">
          <h2>Características</h2>
          <div class="charset">
            <div><h3>Pontos fortes</h3><div class="chips">${chars.positive.length ? chars.positive.map((c) => `<span class="tag ${desired.includes(c) ? '' : 'outline'}">${esc(charLabel(c))}</span>`).join('') : '<span class="sub">—</span>'}</div></div>
            <div><h3>Pontos fracos</h3><div class="chips">${chars.negative.length ? chars.negative.map((c) => `<span class="tag weak">${esc(charLabel(c))}</span>`).join('') : '<span class="sub">Nenhum destacado</span>'}</div></div>
          </div>
          <p class="sub">${chars.source === 'estatisticas'
            ? 'Derivadas das estatísticas por 90 minutos da temporada, comparadas a jogadores da mesma função.'
            : `Características informadas pela fonte (${esc(p.source)}).`}
            ${desired.length ? ' Preenchidas em preto: as que você procurou.' : ''}</p>
        </section>
      </div>
      ${links.length ? `<p class="foot-note">${links.map(([k, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener">Ver no ${esc(k)}</a>`).join(' · ')}</p>` : ''}
      <p class="foot-note">Fonte: ${esc(p.source === 'demo' ? 'dados de demonstração (fictícios)' : p.source)}. Use como apoio à observação do scout.</p>
    </article>
  </section>`;
}

// Campo 105x68 com pontos de presença (x: 0 = própria meta → 100 = meta adversária).
function heatmap(h) {
  const pts = h?.points || [];
  if (!pts.length) return '<p class="sub">A fonte não forneceu mapa de calor para este jogador.</p>';
  const W = 105, H = 68;
  const max = Math.max(...pts.map((p) => p.count || 1));
  const dots = pts
    .map((p) => `<circle cx="${(p.x / 100) * W}" cy="${(p.y / 100) * H}" r="5" fill="var(--ink)" fill-opacity="${(0.1 + 0.18 * ((p.count || 1) / max)).toFixed(3)}" />`)
    .join('');
  return `
  <svg class="pitch" viewBox="-2 -2 ${W + 4} ${H + 7}" role="img" aria-label="Mapa de calor: áreas do campo onde o jogador mais atua">
    <defs>
      <filter id="blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.6" /></filter>
      <clipPath id="field"><rect x="0" y="0" width="${W}" height="${H}" /></clipPath>
    </defs>
    <rect x="0" y="0" width="${W}" height="${H}" fill="var(--cream-2)" />
    <g filter="url(#blur)" clip-path="url(#field)">${dots}</g>
    <g fill="none" stroke="var(--ink)" stroke-width="0.5">
      <rect x="0" y="0" width="${W}" height="${H}" />
      <line x1="${W / 2}" y1="0" x2="${W / 2}" y2="${H}" />
      <circle cx="${W / 2}" cy="${H / 2}" r="9.15" />
      <rect x="0" y="${H / 2 - 20.16}" width="16.5" height="40.32" />
      <rect x="${W - 16.5}" y="${H / 2 - 20.16}" width="16.5" height="40.32" />
      <rect x="0" y="${H / 2 - 9.16}" width="5.5" height="18.32" />
      <rect x="${W - 5.5}" y="${H / 2 - 9.16}" width="5.5" height="18.32" />
    </g>
    <text x="${W}" y="${H + 4}" text-anchor="end" font-size="2.6" fill="var(--muted)" font-family="IBM Plex Mono">ataque →</text>
  </svg>
  ${h.season || h.competition ? `<p class="sub">${esc([h.competition, h.season].filter(Boolean).join(' · '))}</p>` : ''}`;
}

// ---------- início ----------
(async function init() {
  try {
    meta = await (await fetch('/api/meta')).json();
    route();
  } catch (e) {
    app.innerHTML = `<div class="loading">Falha ao iniciar: ${esc(e.message)}</div>`;
  }
})();
