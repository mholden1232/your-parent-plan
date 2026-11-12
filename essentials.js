// Essentials: the "Who would we call?" list of important people.
// Saved to the account as the "people" section via plan-store.js.
(function(){
  let people = [];
  const $ = id => document.getElementById(id);
  const FIELDS = ['Name','Role','Phone','Email','Org','Notes'];

  function esc(s){
    return String(s || '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function persist(){ window.yppStore && window.yppStore.save('people', {people}); }

  function render(){
    const list = $('peopleList');
    if(!people.length){
      list.innerHTML = '<div class="empty-state"><h3>No one added yet</h3><p class="small">Start with the person your family would call first: an attorney, a doctor, a neighbor with a key.</p></div>';
      return;
    }
    list.innerHTML = people.map(p=>{
      const phone = p.phone ? `<a href="tel:${esc(p.phone.replace(/[^0-9+]/g,''))}">${esc(p.phone)}</a>` : '';
      const email = p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : '';
      return `<article class="person" data-id="${esc(p.id)}">
        <div class="person-main">
          <div>
            ${p.role ? `<span class="status">${esc(p.role)}</span>` : ''}
            <h3>${esc(p.name)}</h3>
            ${p.org ? `<p class="small">${esc(p.org)}</p>` : ''}
          </div>
          <div class="vault-entry-actions">
            <button class="icon-btn" data-action="edit" type="button">Edit</button>
            <button class="icon-btn" data-action="delete" type="button">Remove</button>
          </div>
        </div>
        ${(phone || email) ? `<p class="person-contact">${[phone,email].filter(Boolean).join(' · ')}</p>` : ''}
        ${p.notes ? `<p class="person-notes">${esc(p.notes)}</p>` : ''}
      </article>`;
    }).join('');
  }

  function openForm(p){
    $('personFormTitle').textContent = p ? 'Edit person' : 'Add a person';
    $('personId').value = p ? p.id : '';
    FIELDS.forEach(f=>{ $('person'+f).value = p ? (p[f.toLowerCase()] || '') : ''; });
    $('personForm').hidden = false;
    $('personName').focus();
  }
  function closeForm(){ $('personForm').hidden = true; }

  document.addEventListener('DOMContentLoaded', async ()=>{
    if(!$('peopleList')) return;
    $('addPersonBtn').addEventListener('click', ()=>openForm(null));
    $('cancelPersonBtn').addEventListener('click', closeForm);

    $('personForm').addEventListener('submit', e=>{
      e.preventDefault();
      const name = $('personName').value.trim();
      if(!name){ $('personName').focus(); return; }
      const id = $('personId').value || ('p' + Date.now().toString(36) + Math.random().toString(36).slice(2,6));
      const person = {id};
      FIELDS.forEach(f=>{ person[f.toLowerCase()] = $('person'+f).value.trim(); });
      const i = people.findIndex(p=>p.id === id);
      if(i >= 0) people[i] = person; else people.push(person);
      persist(); render(); closeForm();
    });

    $('peopleList').addEventListener('click', e=>{
      const btn = e.target.closest('[data-action]');
      const card = e.target.closest('.person');
      if(!btn || !card) return;
      const p = people.find(x=>x.id === card.dataset.id);
      if(!p) return;
      if(btn.dataset.action === 'edit') openForm(p);
      if(btn.dataset.action === 'delete' && confirm('Remove ' + p.name + ' from this list?')){
        people = people.filter(x=>x.id !== p.id);
        persist(); render();
      }
    });

    const saved = window.yppStore ? await window.yppStore.load('people') : null;
    people = (saved && Array.isArray(saved.people)) ? saved.people : [];
    render();
  });
})();
