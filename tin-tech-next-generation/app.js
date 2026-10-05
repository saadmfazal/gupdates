(() => {
  'use strict';
  const $ = (s,c=document) => c.querySelector(s);
  const $$ = (s,c=document) => [...c.querySelectorAll(s)];
  const products = window.TinTechProducts || {};
  const pathways = window.TinTechPathways || {};
  const motion = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
  const params = new URLSearchParams(location.search);

  // Preserve links shared before the site was split into pages.
  if (document.body.dataset.page === 'home') {
    const legacy = {range:'products.html',caddies:'caddies.html',system:'manufacturing.html',tooling:'manufacturing.html','tooling-terms':'manufacturing.html',programs:'production.html',company:'about.html',locations:'about.html',start:'contact.html',contact:'contact.html'};
    const key = location.hash.slice(1);
    if (legacy[key]) { location.replace(legacy[key]+location.hash); return; }
  }

  const menu = $('.menu'), nav = $('#nav');
  function closeMenu() { menu.setAttribute('aria-expanded','false');nav.classList.remove('open'); }
  menu.addEventListener('click',() => {const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));nav.classList.toggle('open',open);});
  $$('#nav a').forEach(a=>a.addEventListener('click',closeMenu));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menu.getAttribute('aria-expanded')==='true'){closeMenu();menu.focus();}});
  window.addEventListener('resize',()=>{if(innerWidth>1220)closeMenu();});
  const revealObserver=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');revealObserver.unobserve(e.target);}}),{threshold:.08});
  $$('.reveal').forEach(e=>revealObserver.observe(e));
  function toast(text){const e=$('#toast');e.textContent=text;e.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>e.classList.remove('show'),2600);}

  const search=$('#range-search');
  if(search){
    const cards=$$('.range-card'),filters=$$('[data-filter]');
    let category=filters.some(b=>b.dataset.filter===params.get('category'))?params.get('category'):'all';
    function apply(){const q=search.value.trim().toLowerCase();let count=0;cards.forEach(card=>{const visible=(category==='all'||card.dataset.category===category)&&(!q||card.dataset.search.includes(q));card.hidden=!visible;if(visible)count++;});filters.forEach(b=>{const active=b.dataset.filter===category;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});$('#range-results').textContent=count===cards.length?'Showing the full range.':`Showing ${count} direction${count===1?'':'s'}.`;$('#range-empty').hidden=count!==0;}
    filters.forEach(b=>b.addEventListener('click',()=>{category=b.dataset.filter;apply();}));
    search.addEventListener('input',apply);
    $('#range-reset').addEventListener('click',()=>{category='all';search.value='';apply();search.focus({preventScroll:true});});
    apply();
  }

  const dialog=$('#product-dialog');
  if(dialog){
    $$('[data-product]').forEach(button=>button.addEventListener('click',()=>{
      const key=button.dataset.product,p=products[key];if(!p)return;
      $('#dialog-kicker').textContent=p.kicker;$('#dialog-title').textContent=p.title;$('#dialog-description').textContent=p.description;
      $('#dialog-image').src=p.image;$('#dialog-image').alt=p.title;
      const dl=$('#dialog-facts');dl.replaceChildren();
      p.facts.forEach(([label,value])=>{const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;row.append(dt,dd);dl.append(row);});
      $('#dialog-action').href='contact.html?product='+encodeURIComponent(key)+'#start';
      dialog.showModal();document.body.classList.add('dialog-open');
    }));
    $('.dialog-close').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('close',()=>document.body.classList.remove('dialog-open'));
    dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  }

  // Native disclosures keep every answer immediately under its own heading.
  // This also supports browsers without exclusive details-name behavior.
  $$('details[name]').forEach(item=>item.addEventListener('toggle',()=>{
    if(!item.open)return;
    $$('details[name]').filter(other=>other!==item&&other.getAttribute('name')===item.getAttribute('name')).forEach(other=>other.open=false);
  }));
  const requestedPath=params.get('pathway');
  if(document.body.dataset.page==='production'&&pathways[requestedPath]){
    const selected=$('[data-path="'+requestedPath+'"]');if(selected)selected.open=true;
  }

  const map=$('#location-map');
  if(map){
    const views={global:['assets/world-map.svg','Tin Tech operating regions: New York and Sri Lanka'],ny:['assets/world-map-ny.svg','New York commercial coordination region'],lk:['assets/world-map-lk.svg','Sri Lanka development and manufacturing region']};
    $$('[data-map]').forEach(button=>button.addEventListener('click',()=>{const view=views[button.dataset.map];map.src=view[0];map.alt=view[1];$$('[data-map]').forEach(b=>{const active=b===button;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});}));
  }

  const form=$('#project-form');
  if(!form)return;
  const sets=$$('fieldset',form),progress=$$('.form-progress span',form),next=$('#form-next'),back=$('#form-back'),copy=$('#form-copy'),email=$('#form-email');
  let step=0;
  function rows(){const d=new FormData(form);return [['Product family',d.get('family')],['Selected format',d.get('platform')],['Production pathway',d.get('pathway')],['Product or problem',d.get('brief')],['Starting point',d.get('starting')],['Expected volume',d.get('volume')],['Delivery destination',d.get('destination')],['Name',d.get('name')],['Email',d.get('email')],['Company',d.get('company')],['Phone',d.get('phone')]].filter(([,v])=>v&&String(v).trim());}
  function text(){return 'TIN TECH MANUFACTURING BRIEF\n\n'+rows().map(([a,v])=>`${a}: ${String(v).trim()}`).join('\n')+'\n\nPlease review the appropriate product, tooling and production route.';}
  function review(){const target=$('#brief-review');target.replaceChildren();rows().forEach(([a,v])=>{const p=document.createElement('p'),label=document.createElement('span'),value=document.createElement('b');label.textContent=a;value.textContent=v;p.append(label,value);target.append(p);});}
  function direction(){const value=[form.elements.platform.value,form.elements.pathway.value].filter(Boolean).join(' / '),e=$('#selected-direction');e.hidden=!value;e.textContent=value?'Starting with: '+value:'';}
  function show(n,focus=false){step=Math.max(0,Math.min(2,n));sets.forEach((s,i)=>s.hidden=i!==step);progress.forEach((p,i)=>{p.classList.toggle('active',i===step);if(i===step)p.setAttribute('aria-current','step');else p.removeAttribute('aria-current');});back.hidden=step===0;next.hidden=step===2;copy.hidden=step!==2;email.hidden=step!==2;$('#form-message').textContent='';if(step===2)review();if(focus){const legend=$('legend',sets[step]);legend.tabIndex=-1;legend.focus({preventScroll:true});form.scrollIntoView({behavior:motion(),block:'start'});}}
  const productKey=params.get('product');
  if(products[productKey]){const families={retail:'Retail component',components:'Custom molded part',program:'Production program'};form.elements.family.value=families[productKey]||'Packaging system';form.elements.platform.value=products[productKey].title;form.elements.starting.value='An existing product';}
  if(pathways[requestedPath]){form.elements.family.value='Production program';form.elements.pathway.value=pathways[requestedPath].name;}
  direction();show(0);
  next.addEventListener('click',()=>{if(step===1){const requirement=form.elements.brief;requirement.setCustomValidity(requirement.value.trim().length<10?'Please describe your product in at least 10 characters.':'');if(!requirement.reportValidity())return;}show(step+1,true);});
  form.elements.brief.addEventListener('input',()=>form.elements.brief.setCustomValidity(''));
  back.addEventListener('click',()=>show(step-1,true));
  form.addEventListener('input',()=>{if(step===2)review();});
  $$('[name="family"]').forEach(radio=>radio.addEventListener('change',()=>{form.elements.platform.value='';form.elements.pathway.value='';direction();}));
  copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(text());$('#form-message').textContent='Brief copied. Paste it into your email to sales@tintechpackaging.com.';toast('Manufacturing brief copied');}catch{$('#form-message').textContent='Select and copy the brief above, then email sales@tintechpackaging.com.';}});
  form.addEventListener('submit',e=>{e.preventDefault();if(step!==2){next.click();return;}if(!form.reportValidity())return;const subject='Tin Tech product brief — '+(form.elements.company.value.trim()||form.elements.family.value);const url='mailto:sales@tintechpackaging.com?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(text());$('#form-message').textContent='Your email app will open with the brief. Attach any files and send when ready.';window.location.href=url;});
})();
