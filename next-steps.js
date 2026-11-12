// My Plan: "Your Next 3 Things".
// Free: the first three unchecked checklist items.
// Plus: ranked from everything in the plan (checklist, Essentials, people,
// Money, Care and documents), each with the reason and a link.
(function(){
  let cache = null;

  function esc(s){
    return String(s || '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  const filled = v => typeof v === 'string' ? v.trim().length > 0 : !!v;
  const num = v => Number(v) || 0;

  async function gather(){
    if(cache) return cache;
    const s = window.yppStore;
    const p = await s.plan();
    const [essentials, people, money, care] = await Promise.all(
      ['essentials','people','money','care'].map(k=>s.load(k)));
    let docCount = null;
    const c = window.yppAuthClient;
    if(c && p && p.ownerId){
      const {count, error} = await c.from('documents').select('id', {count:'exact', head:true}).eq('user_id', p.ownerId);
      if(!error) docCount = count || 0;
    }
    cache = {p, essentials: essentials || {}, people: (people && people.people) || [], money: money || {}, care: (care && care.facilities) || [], docCount};
    return cache;
  }

  // Each rule: when it applies, a priority (higher first), the step, why, and where to go.
  function smartSteps(d, done){
    const e = d.essentials, m = d.money;
    const steps = [];
    const add = (score, title, why, href, covers) => steps.push({score, title, why, href, covers});

    if(!done['Health-care proxy / medical POA located'] && !filled(e.healthProxy))
      add(100, 'Find the health-care proxy', 'Doctors need it if your parent can’t speak for themselves. Note who holds it and where it’s kept.', 'information.html', 'Health-care proxy / medical POA located');
    if(!done['Financial power of attorney located'] && !filled(e.financialPoa))
      add(95, 'Locate the financial power of attorney', 'Without it, paying bills or talking to the bank on their behalf can require a court process.', 'information.html', 'Financial power of attorney located');
    if(!filled(e.emergencyContact))
      add(90, 'Add an emergency contact', 'The first thing anyone will look for in a hurry.', 'information.html');
    if(!filled(e.medications) && !done['Medication list current for reference'])
      add(85, 'Write down current medications', 'ER staff and new doctors ask for this first. Name, dose and prescriber is enough.', 'information.html', 'Medication list current for reference');
    if(!filled(e.primaryDoctor) || !filled(e.pharmacy))
      add(75, 'Record the doctor and pharmacy', 'So anyone helping knows who to call for refills and records.', 'information.html', 'Doctors / pharmacy recorded');
    if(!done['Advance directive / living will located'] && !filled(e.willTrust))
      add(72, 'Find the advance directive or living will', 'It spells out the care your parent wants. Know whether it exists and where.', 'information.html', 'Advance directive / living will located');
    if(!filled(e.healthInsurance))
      add(70, 'Note Medicare and insurance details', 'Needed for every appointment, hospital stay and claim.', 'information.html', 'Insurance policies identified');
    if(!d.people.length)
      add(65, 'Add the people your family would call', 'Attorney, financial advisor, a neighbor with a key: one list saves a lot of searching.', 'information.html');

    const income = Object.keys(m).filter(k=>k.startsWith('income_')).reduce((a,k)=>a+num(m[k]),0);
    const expenses = Object.keys(m).filter(k=>k.startsWith('exp_')).reduce((a,k)=>a+num(m[k]),0);
    if(!income)
      add(60, 'Fill in the Money Snapshot', 'Knowing monthly income makes every care decision easier to judge.', 'money.html');
    else if(expenses > income)
      add(80, 'Review monthly bills', `Obligations are about $${Math.round(expenses-income).toLocaleString()} a month more than income. See what can change before care costs start.`, 'money.html');

    if(!d.care.length && !done['Future living-care options discussed'])
      add(50, 'Start a care comparison', 'Add one community you’d consider, even before anyone needs it.', 'care.html', 'Future living-care options discussed');
    if(d.docCount === 0)
      add(55, 'Scan the most important document', 'A copy of the power of attorney or insurance card in the plan beats a search through drawers.', 'scan.html');

    // Remaining checklist items, in checklist order, below the specific steps.
    Object.keys(done).forEach((label, i)=>{
      if(!done[label] && !steps.some(s=>s.covers === label))
        add(40 - i, label, 'Still open on your preparedness checklist.', '#preparedness');
    });
    return steps.sort((a,b)=>b.score-a.score).slice(0,3);
  }

  async function render(checks, el){
    const done = {};
    checks.forEach(cb=>{ done[cb.dataset.label] = cb.checked; });
    let d = null;
    try{ d = await gather(); }catch(e){}
    const plus = d && d.p && d.p.isPlus;

    if(!plus){
      const missing = checks.filter(cb=>!cb.checked).slice(0,3);
      el.innerHTML = (missing.length
        ? missing.map((cb,i)=>`<div class="mini"><b>${i+1}. ${esc(cb.dataset.label)}</b></div>`).join('')
        : '<div class="mini"><b>Core preparedness checklist complete</b><br><span class="small">Review periodically and update when circumstances change.</span></div>') +
        (d && d.p && d.p.ownerId ? '<p class="small next-upsell">With <a href="pricing.html">Plus</a>, these are picked from your whole plan (Essentials, money, care and documents) with the reason for each.</p>' : '');
      return;
    }
    const steps = smartSteps(d, done);
    el.innerHTML = steps.length ? steps.map((s,i)=>`
      <div class="mini next-step">
        <a href="${esc(s.href)}"><b>${i+1}. ${esc(s.title)}</b></a>
        <span class="small">${esc(s.why)}</span>
      </div>`).join('')
      : '<div class="mini"><b>Nothing urgent.</b><br><span class="small">Your plan covers the essentials. Review it every few months or when something changes.</span></div>';
  }

  window.yppNextSteps = render;
})();
