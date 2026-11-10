const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const MARKET_DESC = {
  interno: 'Atletas que jogam em ligas do mesmo país do seu clube.',
  externo: 'Atletas que jogam em outros países do mesmo continente.',
  internacional: 'Atletas que jogam em ligas de outros continentes.',
};
const SUGGESTIONS = ['rápido', 'canhoto', 'destro', 'driblador', 'finalizador', 'bom passe', 'visão de jogo', 'bom no jogo aéreo', 'forte fisicamente', 'intenso', 'marcador', 'jovem', 'experiente', 'regular'];

let meta = null;
let lastResult = null;
let activeMarket = 'interno';
let lastQueryKey = '';

const money = (eur) => {
  if (eur >= 1e6) return `€ ${(eur / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi`;
  if (eur >= 1e3) return `€ ${Math.round(eur / 1e3).toLocaleString('pt-BR')} mil`;
  return `€ ${eur}`;
};
const countryName = (code) => meta.countries.find((c) => c.code === code)?.name || code || '—';
const positionName = (code) => meta.positions.find((p) => p.code === code)?.name || code;
const parseBudget = (s) => Number(String(s).replace(/[^\d]/g, ''));

async function init() {
  meta = await (await fetch('/api/meta')).json();
  const form = $('#search');
  const byContinent = {};
  for (const c of meta.countries) (byContinent[c.continent] ||= []).push(c);
  form.country.innerHTML = Object.entries(byContinent)
    .map(([k, list]) => `<optgroup label="${esc(meta.continents[k])}">${list
      .slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      .map((c) => `<option value="${c.code}">${esc(c.name)}</option>`).join('')}</optgroup>`)
    .join('');
  form.country.value = 'BR';
  form.position.innerHTML = meta.positions.map((p) => `<option value="${p.code}">${esc(p.name)}</option>`).join('');
  form.position.value = 'ST';

  form.maxBudgetEur.addEventListener('input', () => {
    const n = parseBudget(form.maxBudgetEur.value);
    form.maxBudgetEur.value = n ? n.toLocaleString('pt-BR') : '';
    $('#budgetHint').textContent = n ? `Até ${money(n)} de valor de mercado` : 'Valor de mercado máximo do atleta';
  });

  const chips = $('#suggestions');
  chips.innerHTML = SUGGESTIONS.map((s) => `<button type="button" class="chip" data-v="${esc(s)}">${esc(s)}</button>`).join('');
  chips.addEventListener('click', (e) => {
    const v = e.target.dataset?.v;
    if (!v) return;
    const ta = form.characteristics;
    const parts = ta.value.split(',').map((x) => x.trim()).filter(Boolean);
    const i = parts.indexOf(v);
    if (i >= 0) parts.splice(i, 1);
    else parts.push(v);
    ta.value = parts.join(', ');
    syncChips();
  });
  form.characteristics.addEventListener('input', syncChips);

  form.addEventListener('submit', onSearch);
  $('#results').addEventListener('click', onResultsClick);
}

function syncChips() {
  const parts = $('#search').characteristics.value.split(',').map((x) => x.trim());
  for (const b of document.querySelectorAll('#suggestions .chip')) b.classList.toggle('on', parts.includes(b.dataset.v));
}

async function onSearch(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const body = {
    country: form.country.value,
    maxBudgetEur: parseBudget(form.maxBudgetEur.value),
    position: form.position.value,
    characteristics: form.characteristics.value.trim(),
  };
  const err = $('#formError');
  err.textContent = '';
  if (!body.maxBudgetEur) {
    err.textContent = 'Informe o teto orçamentário.';
    form.maxBudgetEur.focus();
    return;
  }
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Consultando fontes…';
  try {
    const res = await fetch('/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error((data.errors || ['Erro na busca.']).join(' '));
    lastResult = data;
    const key = `${body.country}|${body.position}`;
    if (key !== lastQueryKey) {
      // Abre a primeira aba com resultados
      activeMarket = Object.keys(meta.markets).find((k) => data.markets[k].length) || 'interno';
      lastQueryKey = key;
    }
    renderResults();
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Buscar jogadores';
  }
}

function renderResults() {
  const d = lastResult;
  const el = $('#results');
  const tags = [
    `<span class="tag">${esc(countryName(d.query.country))}</span>`,
    `<span class="tag">${esc(positionName(d.query.position))}</span>`,
    `<span class="tag">até ${money(d.query.maxBudgetEur)}</span>`,
    ...d.criteria.traits.map((t) => `<span class="tag">${esc(t)}</span>`),
  ];
  const f = d.criteria.filters;
  if (f.foot) tags.push(`<span class="tag">pé ${esc(f.foot)}</span>`);
  if (f.maxAge) tags.push(`<span class="tag">até ${f.maxAge} anos</span>`);
  if (f.minAge) tags.push(`<span class="tag">${f.minAge}+ anos</span>`);
  if (f.minHeightCm) tags.push(`<span class="tag">${f.minHeightCm}+ cm</span>`);

  const warns = [];
  if (d.providers.length === 1 && d.providers[0] === 'demo') warns.push('Usando dados de demonstração (jogadores fictícios). Configure provedores reais para resultados de mercado.');
  warns.push(...(d.criteria.warnings || []));
  for (const pe of d.providerErrors || [])warns.push(`Fonte "${pe.provider}" indisponível: ${pe.message}`);
  if (d.criteria.text && !d.criteria.traits.length && !Object.keys(f).length) warns.push('Nenhuma característica reconhecida no texto; o ranking usa o perfil padrão da posição.');

  el.innerHTML = `
    <div class="summary">${d.total} jogadores dentro do perfil · ${tags.join('')}</div>
    ${warns.map((w) => `<div class="warn">${esc(w)}</div>`).join('')}
    <div class="tabs" role="tablist">
      ${Object.entries(meta.markets).map(([k, label]) => `
        <button class="tab" role="tab" data-market="${k}" style="--m: var(--${k})" aria-selected="${k === activeMarket}">
          ${esc(label)}<span class="count">${d.markets[k].length}</span>
        </button>`).join('')}
    </div>
    <p class="tab-desc">${esc(MARKET_DESC[activeMarket])} Ordenado por aderência ao perfil pedido, não por qualidade geral.</p>
    <div class="list" style="--m: var(--${activeMarket})">
      ${d.markets[activeMarket].length
        ? d.markets[activeMarket].map((p, i) => card(p, i)).join('')
        : '<div class="none">Nenhum jogador encontrado neste mercado com esses critérios. Tente ampliar o orçamento ou flexibilizar as características.</div>'}
    </div>`;
}

function card(p, i) {
  return `
    <button class="card" data-id="${esc(p.id)}" data-market="${p.market}">
      <span class="rank">${i + 1}</span>
      <span class="who">
        <strong>${esc(p.name)}</strong>
        <span>${esc(p.club)} · ${esc(countryName(p.leagueCountry))} · ${p.age} anos · pé ${esc(p.foot)}</span>
        <span class="traits">${(p.strengths || []).map((s) => `<i>${esc(s.label)} ${s.value}</i>`).join('')}</span>
      </span>
      <span class="value">${money(p.marketValueEur)}<small>valor de mercado</small></span>
      <span class="fit"><strong>${p.fit}</strong><small>aderência</small></span>
    </button>`;
}

function onResultsClick(e) {
  const tab = e.target.closest('.tab');
  if (tab) {
    activeMarket = tab.dataset.market;
    renderResults();
    return;
  }
  const c = e.target.closest('.card');
  if (c) openDashboard(c.dataset.id, c.dataset.market);
}

async function openDashboard(id, market) {
  const dlg = $('#dashboard');
  const summary = Object.values(lastResult.markets).flat().find((p) => p.id === id);
  dlg.style.setProperty('--m', `var(--${market})`);
  dlg.innerHTML = '<div class="dash-body">Carregando…</div>';
  dlg.showModal();
  try {
    const res = await fetch(`/api/players/${encodeURIComponent(id)}`);
    const p = await res.json();
    if (!res.ok) throw new Error((p.errors || []).join(' '));
    dlg.innerHTML = dashboard(p, summary, market);
  } catch (ex) {
    dlg.innerHTML = `<div class="dash-body"><p class="error">${esc(ex.message || 'Erro ao carregar o jogador.')}</p><button class="close" data-close>×</button></div>`;
  }
}

$('#dashboard').addEventListener('click', (e) => {
  if (e.target.closest('[data-close]') || e.target === e.currentTarget) e.currentTarget.close();
});

function dashboard(p, summary, market) {
  const s = p.stats || {};
  const per90 = (v) => (v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  const pct = (v) => `${Math.round(v ?? 0)}%`;
  const isGK = p.position === 'GK';
  const statRows = isGK
    ? [['Defesas /90', s.saves, 5, per90], ['% de defesas', s.savePct, 100, pct], ['Precisão de passe', s.passAccuracy, 100, pct], ['Duelos aéreos /90', s.aerialsWon, 4, per90], ['Nota média', s.rating, 10, per90]]
    : [
        ['Gols /90', s.goals, 1, per90], ['xG /90', s.xg, 1, per90], ['Assistências /90', s.assists, 0.6, per90],
        ['Passes-chave /90', s.keyPasses, 3.5, per90], ['Dribles /90', s.dribbles, 4, per90], ['Desarmes /90', s.tackles, 4, per90],
        ['Interceptações /90', s.interceptions, 3, per90], ['Duelos aéreos /90', s.aerialsWon, 6, per90],
        ['Precisão de passe', s.passAccuracy, 100, pct], ['Duelos ganhos', s.duelsWonPct, 100, pct],
        ['Velocidade máx. (km/h)', s.topSpeedKmh, 38, per90], ['Nota média', s.rating, 10, per90],
      ];
  const attrs = Object.entries(meta.attributes).filter(([k]) => (isGK ? true : k !== 'goleiro'));
  const links = Object.entries(p.links || {}).filter(([, url]) => /^https?:\/\//.test(url));
  return `
    <div class="dash-head">
      <div>
        <h1>${esc(p.name)} <span class="badge">${esc(meta.markets[market])}</span></h1>
        <p>${esc(positionName(p.position))} · ${esc(p.club)} · ${esc(p.league)} (${esc(countryName(p.leagueCountry))})</p>
      </div>
      <button class="close" data-close aria-label="Fechar">×</button>
    </div>
    <div class="dash-body">
      <div class="kpis">
        ${kpi('Aderência', summary ? summary.fit : '—')}
        ${kpi('Valor de mercado', money(p.marketValueEur))}
        ${kpi('Idade', `${p.age} anos`)}
        ${kpi('Nacionalidade', countryName(p.nationality))}
        ${kpi('Altura', p.heightCm ? `${(p.heightCm / 100).toFixed(2).replace('.', ',')} m` : '—')}
        ${kpi('Pé', p.foot || '—')}
        ${kpi('Contrato até', p.contractUntil ? new Date(p.contractUntil + 'T00:00').toLocaleDateString('pt-BR') : '—')}
        ${kpi(`Temporada ${esc(p.season || '')}`, `${p.appearances ?? '—'} jogos · ${(p.minutes ?? 0).toLocaleString('pt-BR')} min`)}
      </div>
      <div class="dash-grid">
        <div class="box"><h3>Perfil de atributos</h3>${radar(attrs.map(([k, label]) => [label, p.attributes[k] ?? 0]))}</div>
        <div class="box"><h3>Atributos (0–100)</h3><div class="bars">
          ${attrs.map(([k, label]) => bar(label, p.attributes[k] ?? 0, 100, (v) => v)).join('')}
        </div></div>
      </div>
      <div class="box"><h3>Estatísticas da temporada</h3><div class="bars">
        ${statRows.map(([l, v, max, fmt]) => bar(l, v ?? 0, max, fmt)).join('')}
      </div></div>
      ${links.length ? `<div class="links">${links.map(([k, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener">Ver no ${esc(k)}</a>`).join('')}</div>` : ''}
      <p class="disclaimer">Fonte: ${esc(p.source === 'demo' ? 'dados de demonstração (fictícios)' : p.source)}. Atributos derivados das estatísticas por 90 minutos; use como apoio, não como substituto da observação do scout.</p>
    </div>`;
}

const kpi = (label, value) => `<div class="kpi"><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`;

function bar(label, value, max, fmt) {
  const w = Math.max(0, Math.min(100, (value / max) * 100));
  return `<div class="bar"><span>${esc(label)}</span><span class="track"><i style="width:${w}%"></i></span><b>${esc(fmt(value))}</b></div>`;
}

function radar(points) {
  const size = 320, c = size / 2, r = 110, n = points.length;
  const ang = (i) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pt = (i, v) => [c + Math.cos(ang(i)) * r * v, c + Math.sin(ang(i)) * r * v];
  const rings = [0.25, 0.5, 0.75, 1]
    .map((f) => `<polygon points="${points.map((_, i) => pt(i, f).join(',')).join(' ')}" fill="none" stroke="var(--line)" />`).join('');
  const axes = points.map((_, i) => `<line x1="${c}" y1="${c}" x2="${pt(i, 1)[0]}" y2="${pt(i, 1)[1]}" stroke="var(--line)" />`).join('');
  const shape = points.map(([, v], i) => pt(i, v / 100).join(',')).join(' ');
  const labels = points.map(([l, v], i) => {
    const [x, y] = pt(i, 1.2);
    const anchor = Math.abs(x - c) < 5 ? 'middle' : x > c ? 'start' : 'end';
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle">${esc(l)} ${Math.round(v)}</text>`;
  }).join('');
  return `<svg class="radar" viewBox="-60 -10 ${size + 120} ${size + 20}" role="img" aria-label="Radar de atributos">
    ${rings}${axes}
    <polygon points="${shape}" fill="color-mix(in srgb, var(--m) 30%, transparent)" stroke="var(--m)" stroke-width="2" />
    ${labels}</svg>`;
}

init().catch((e) => {
  $('#results').innerHTML = `<div class="none">Falha ao iniciar: ${esc(e.message)}</div>`;
});
