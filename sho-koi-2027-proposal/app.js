(function(){
  const plans={
    6000:{dec:1700,jan:2300,feb:2000},
    6500:{dec:1800,jan:2500,feb:2200},
    7000:{dec:2000,jan:2700,feb:2300}
  };
  const nf=new Intl.NumberFormat('en-US');
  const kgToLbs=(kg)=>Math.round(kg*2.20462);
  const formatWeight=(kg)=>nf.format(kgToLbs(kg))+' lbs ('+nf.format(kg)+' kg)';
  const targetButtons=[...document.querySelectorAll('[data-target]')];
  function setPlan(t){
    const p=plans[t]||plans[6500], max=Math.max(p.dec,p.jan,p.feb);
    document.getElementById('targetTotal').textContent=formatWeight(Number(t));
    [['Dec','dec'],['Jan','jan'],['Feb','feb']].forEach(([id,key])=>{
      document.getElementById('kg'+id).textContent=formatWeight(p[key]);
      document.getElementById('bar'+id).style.width=Math.round((p[key]/max)*100)+'%';
    });
    targetButtons.forEach(b=>b.classList.toggle('active',Number(b.dataset.target)===Number(t)));
  }
  targetButtons.forEach(b=>b.addEventListener('click',()=>setPlan(Number(b.dataset.target))));
  setPlan(6500);

  const moq={
    balanced:{high:4,mid:2,low:4},
    lean:{high:3,mid:2,low:5}
  };
  const moqButtons=[...document.querySelectorAll('[data-moq]')];
  function setMoq(k){
    const m=moq[k]||moq.balanced;
    const high=m.high*5000, mid=m.mid*3000, low=m.low*1000, total=high+mid+low;
    document.getElementById('highQty').textContent=(high/1000)+'k';
    document.getElementById('midQty').textContent=(mid/1000)+'k';
    document.getElementById('lowQty').textContent=(low/1000)+'k';
    document.getElementById('bagTotal').textContent=nf.format(total);
    moqButtons.forEach(b=>b.classList.toggle('active',b.dataset.moq===k));
  }
  moqButtons.forEach(b=>b.addEventListener('click',()=>setMoq(b.dataset.moq)));
  setMoq('balanced');

  const checks=[...document.querySelectorAll('#checks input[type="checkbox"]')];
  const state=document.getElementById('decisionState'), copy=document.getElementById('decisionText'), bar=document.getElementById('decisionBar');
  function updateDecision(){
    const n=checks.filter(c=>c.checked).length;
    bar.style.width=(n/3*100)+'%';
    if(n===0){state.textContent='Ready to review.';copy.textContent='Tick the three items to see the full 2027 operating plan locked together.'}
    else if(n<3){state.textContent=n+' of 3 aligned.';copy.textContent='The structure is taking shape. '+(3-n)+' approval'+(3-n===1?'':'s')+' still open.'}
    else{state.textContent='2027 plan aligned.';copy.textContent='Packaging, pre-season stock and the monthly supply + sales rhythm now work as one system.'}
  }
  checks.forEach(c=>c.addEventListener('change',updateDecision));
  updateDecision();

  const els=[...document.querySelectorAll('.reveal')];
  if('IntersectionObserver' in window){
    const io=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('on');io.unobserve(e.target)}}),{threshold:.08});
    els.forEach(el=>io.observe(el));
  }else{els.forEach(el=>el.classList.add('on'))}
})();