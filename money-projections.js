// Money Snapshot (Plus): how long savings would cover the gap between
// dependable income and the cost of care, with yearly price increases.
(function(){
  const $ = id => document.getElementById(id);
  const num = v => Number(v) || 0;
  const usd = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString();
  let facilities = [];

  function available(){
    let inc = 0, exp = 0;
    document.querySelectorAll('.income').forEach(x=>inc += num(x.value));
    document.querySelectorAll('.expense').forEach(x=>exp += num(x.value));
    return inc - exp;
  }

  function project(){
    const cost0 = num($('projCost').value);
    const rate = num($('projIncrease').value);
    const avail = available();
    let savings = num($('careSavings').value);
    const body = $('projTable').querySelector('tbody');
    if(!cost0){
      $('projHeadline').textContent = '—';
      $('projExplain').textContent = 'Enter a monthly cost of care to see the projection.';
      body.innerHTML = '';
      return;
    }
    const rows = [];
    let monthsLasted = null;
    for(let m = 0; m < 360; m++){
      const year = Math.floor(m / 12);
      const cost = cost0 * Math.pow(1 + rate, year);
      const gap = cost - avail;
      if(gap > 0){
        savings -= gap;
        if(savings < 0 && monthsLasted === null) monthsLasted = m;
      }
      if(m % 12 === 11 && year < 5) rows.push({year: year + 1, cost, gap, savings});
    }
    const firstGap = cost0 - avail;
    if(firstGap <= 0){
      $('projHeadline').textContent = 'Income covers it';
      $('projExplain').textContent = `Dependable income covers this cost now, with about ${usd(-firstGap)} a month to spare. Rising prices are shown below.`;
    }else if(monthsLasted === null){
      $('projHeadline').textContent = '30+ years';
      $('projExplain').textContent = `The first-year gap is about ${usd(firstGap)} a month, and savings cover it for more than 30 years.`;
    }else{
      const y = Math.floor(monthsLasted / 12), mo = monthsLasted % 12;
      $('projHeadline').textContent = (y ? y + (y === 1 ? ' year' : ' years') : '') + (y && mo ? ', ' : '') + (mo || !y ? mo + (mo === 1 ? ' month' : ' months') : '');
      $('projExplain').textContent = `Savings would cover a gap of about ${usd(firstGap)} a month at first, growing as prices rise ${Math.round(rate*100)}% a year.`;
    }
    body.innerHTML = rows.map(r=>`<tr><td>Year ${r.year}</td><td>${usd(r.cost)}</td><td>${r.gap > 0 ? usd(r.gap) : 'None'}</td><td>${r.savings < 0 ? '<b>Used up</b>' : usd(r.savings)}</td></tr>`).join('');
  }

  function total(f, level){
    return Object.values((f.costs || {})[level] || {}).reduce((a,b)=>a + num(b), 0);
  }

  document.addEventListener('DOMContentLoaded', async ()=>{
    if(!$('projection')) return;
    const p = window.yppStore ? await window.yppStore.plan() : null;
    const plus = p && p.isPlus;
    if(!plus){
      $('projectionLocked').hidden = false;
      $('projectionBody').hidden = true;
      return;
    }
    const care = await window.yppStore.load('care');
    facilities = (care && care.facilities) || [];
    const opts = [];
    facilities.forEach((f,i)=>{
      [['independent','Independent'],['assisted','Assisted'],['memory','Memory care']].forEach(([l,label])=>{
        const t = total(f, l);
        if(t) opts.push(`<option value="${t}">${String(f.name || 'Facility').replace(/[<>&"]/g,'')}: ${label}, ${usd(t)}/mo</option>`);
      });
    });
    $('projFacility').insertAdjacentHTML('beforeend', opts.join(''));
    $('projFacility').addEventListener('change', ()=>{
      if(!$('projFacility').value) return;
      $('projCost').value = $('projFacility').value;
      $('projCost').dispatchEvent(new Event('input', {bubbles:true}));
    });
    document.addEventListener('input', e=>{ if(e.target.closest('main')) project(); });
    document.addEventListener('change', e=>{ if(e.target.id === 'projIncrease') project(); });
    setTimeout(project, 0);
  });
})();
