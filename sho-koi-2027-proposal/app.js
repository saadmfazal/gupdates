(function(){
  const checks=[...document.querySelectorAll('#checks input[type="checkbox"]')];
  const state=document.getElementById('decisionState');
  const copy=document.getElementById('decisionText');
  const bar=document.getElementById('decisionBar');

  function updateDecision(){
    if(!state || !copy || !bar) return;
    const total=checks.length || 4;
    const n=checks.filter(c=>c.checked).length;
    bar.style.width=(n/total*100)+'%';
    if(n===0){
      state.textContent='Ready to review.';
      copy.textContent='Four linked decisions turn this from a proposal into the 2027 operating system.';
    }else if(n<total){
      state.textContent=n+' of '+total+' aligned.';
      const left=total-n;
      copy.textContent=left+' decision'+(left===1?'':'s')+' remain before the full plan is locked.';
    }else{
      state.textContent='2027 operating plan aligned.';
      copy.textContent='Packaging, opening stock, commercial structure and the monthly supply + sales model now work as one system.';
    }
  }
  checks.forEach(c=>c.addEventListener('change',updateDecision));
  updateDecision();

  const els=[...document.querySelectorAll('.reveal')];
  if('IntersectionObserver' in window){
    const io=new IntersectionObserver(entries=>{
      entries.forEach(e=>{
        if(e.isIntersecting){
          e.target.classList.add('on');
          io.unobserve(e.target);
        }
      });
    },{threshold:.08});
    els.forEach(el=>io.observe(el));
  }else{
    els.forEach(el=>el.classList.add('on'));
  }
})();