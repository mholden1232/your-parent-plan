
(function(){
  function fmt(n){return (n<0?'-$':'$')+Math.abs(n).toLocaleString(undefined,{maximumFractionDigits:0});}
  function recalcMoney(){
    let income=0, expense=0;
    document.querySelectorAll('.income').forEach(x=>income+=Number(x.value)||0);
    document.querySelectorAll('.expense').forEach(x=>expense+=Number(x.value)||0);
    const out=document.getElementById('availableCare'), exp=document.getElementById('moneyExplanation');
    if(!out)return;
    const v=income-expense;
    out.textContent=fmt(v)+'/mo';
    if(exp) exp.textContent=(income===0&&expense===0)?'Add income and obligations above to calculate.':(v>=0?'Estimated amount available each month before drawing from savings.':'Current obligations exceed dependable monthly income by '+fmt(Math.abs(v))+'.');
  }
  function recalcFacility(){
    const cost=Number((document.getElementById('facilityCost')||{}).value)||0;
    const avail=Number((document.getElementById('availableForCare')||{}).value)||0;
    const savings=Number((document.getElementById('careSavingsMirror')||{}).value)||0;
    const box=document.getElementById('facilityResult'); if(!box)return;
    if(!cost){box.textContent='Enter the facility cost and available monthly budget.';return}
    const gap=avail-cost;
    if(gap>=0){box.className='good';box.textContent='Fits the current monthly budget with about '+fmt(gap)+' left each month before using savings.';}
    else{
      const short=-gap; let msg='Creates an estimated monthly shortfall of '+fmt(short)+'.';
      if(savings>0) msg+=' Savings could cover that gap for about '+(savings/short).toFixed(1)+' months.';
      box.className='alert';box.textContent=msg;
    }
  }
  document.addEventListener('input',function(e){
    if(e.target.classList.contains('money-input'))recalcMoney();
    if(['facilityCost','availableForCare','careSavingsMirror'].includes(e.target.id))recalcFacility();
  });
  recalcMoney();recalcFacility();
})();

(function(){
  function sum(sel){let t=0;document.querySelectorAll(sel).forEach(x=>t+=Number(x.value)||0);return t;}
  function fmt(n){return (n<0?'-$':'$')+Math.abs(n).toLocaleString(undefined,{maximumFractionDigits:0});}
  function recalcCareBuckets(){
    const ind=sum('.ind-cost'), ass=sum('.assisted-cost'), mem=sum('.memory-cost'), one=sum('.one-cost');
    const map={indTotal:ind,assistedTotal:ass,memoryTotal:mem,oneTotal:one,tableInd:ind,tableAssisted:ass,tableMemory:mem};
    Object.keys(map).forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=fmt(map[id])+(id==='oneTotal'?'':'/mo');});
    const ad=document.getElementById('assistedDiff'), md=document.getElementById('memoryDiff');
    if(ad)ad.textContent=fmt(ass-ind)+'/mo';
    if(md)md.textContent=fmt(mem-ind)+'/mo';

    const level=(document.getElementById('careLevelSelect')||{}).value||'assisted';
    const chosen=level==='ind'?ind:(level==='memory'?mem:ass);
    const avail=Number((document.getElementById('availableForCare')||{}).value)||0;
    const savings=Number((document.getElementById('careSavingsMirror')||{}).value)||0;
    const box=document.getElementById('facilityResult');
    if(box){
      if(!chosen){box.className='notice';box.textContent='Enter the cost buckets for the selected level of care.';}
      else{
        const gap=avail-chosen;
        if(gap>=0){
          box.className='good';
          box.textContent='This level fits the entered monthly budget with about '+fmt(gap)+' left each month before using savings.';
        }else{
          const short=-gap;
          let msg='This level creates an estimated monthly shortfall of '+fmt(short)+'.';
          if(savings>0)msg+=' Entered savings could cover that gap for about '+(savings/short).toFixed(1)+' months.';
          box.className='alert';box.textContent=msg;
        }
      }
    }
  }
  document.addEventListener('input',function(e){
    if(e.target.matches('.ind-cost,.assisted-cost,.memory-cost,.one-cost,#availableForCare,#careSavingsMirror,#careLevelSelect'))recalcCareBuckets();
  });
  document.addEventListener('change',function(e){
    if(e.target.id==='careLevelSelect')recalcCareBuckets();
  });
  recalcCareBuckets();
})();

(function(){
 function sum(sel){let t=0;document.querySelectorAll(sel).forEach(x=>t+=Number(x.value)||0);return t}
 function fmt(n){return '$'+Math.max(0,n).toLocaleString(undefined,{maximumFractionDigits:0})}
 function project(){
   const ind=sum('.ind-cost'), ass=sum('.assisted-cost'), mem=sum('.memory-cost');
   const rate=Number((document.getElementById('annualIncrease')||{}).value)||0;
   const years=Number((document.getElementById('projectionYears')||{}).value)||3;
   const factor=Math.pow(1+rate,years);
   const vals={projIndNow:ind,projAssNow:ass,projMemNow:mem,projIndFuture:ind*factor,projAssFuture:ass*factor,projMemFuture:mem*factor};
   Object.entries(vals).forEach(([id,v])=>{const e=document.getElementById(id);if(e)e.textContent=fmt(v)+'/mo'});
   const h=document.getElementById('futureHeader');if(h)h.textContent='In '+years+(years===1?' year':' years');
   const offsets=(Number((document.getElementById('ltcOffset')||{}).value)||0)+(Number((document.getElementById('otherOffset')||{}).value)||0);
   const o=document.getElementById('offsetTotal');if(o)o.textContent=fmt(offsets)+'/mo';
 }
 document.addEventListener('input',e=>{if(e.target.matches('.ind-cost,.assisted-cost,.memory-cost,#annualIncrease,#projectionYears,.offset-input'))project()});
 document.addEventListener('change',e=>{if(e.target.matches('#annualIncrease,#projectionYears'))project()});
 project();
})();
