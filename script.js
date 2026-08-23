document.querySelectorAll('[data-scroll]').forEach(btn=>{
  btn.addEventListener('click',()=>document.querySelector(btn.dataset.scroll)?.scrollIntoView({behavior:'smooth'}));
});
document.querySelectorAll('.filter').forEach(btn=>{
  btn.addEventListener('click',()=>{
    btn.classList.toggle('active');
  });
});
function armusRunHomeSearch(){
  const q=document.getElementById('search').value.trim();
  if(!q){
    document.getElementById('searchMessage').textContent='Arama alanına bir konu, seviye veya öğretmen adı yaz.';
    return;
  }
  window.location.href='teachers.html?q='+encodeURIComponent(q);
}
document.getElementById('searchBtn').addEventListener('click',armusRunHomeSearch);
document.getElementById('search').addEventListener('keydown',e=>{
  if(e.key==='Enter'){
    e.preventDefault();
    armusRunHomeSearch();
  }
});

// Scroll-triggered reveal: elements marked .reveal fade/slide in once
// they enter the viewport.
function armusInitScrollReveal(){
  const targets=document.querySelectorAll('.reveal');
  if(!targets.length)return;
  const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduceMotion||!('IntersectionObserver' in window)){
    targets.forEach(el=>el.classList.add('in-view'));
    return;
  }
  const observer=new IntersectionObserver(entries=>{
    entries.forEach(entry=>{
      if(entry.isIntersecting){
        entry.target.classList.add('in-view');
        observer.unobserve(entry.target);
      }
    });
  },{threshold:0.15,rootMargin:'0px 0px -60px 0px'});
  targets.forEach(el=>observer.observe(el));
}
armusInitScrollReveal();

// Hero teacher-stack carousel: rotates through the demo teacher pool,
// bringing a new teacher into the center card every 10 seconds.
function armusInitHeroRotator(){
  const stack=document.querySelector('.teacher-stack');
  if(!stack||typeof TEACHERS==='undefined'||!TEACHERS.length)return;
  const slots={
    left:stack.querySelector('.teacher-card.left'),
    main:stack.querySelector('.teacher-card.main'),
    right:stack.querySelector('.teacher-card.right'),
  };
  if(!slots.left||!slots.main||!slots.right)return;

  function fillCard(article,teacher){
    article.querySelector('.portrait').className='portrait portrait-'+teacher.id;
    article.querySelector('.portrait').textContent=teacher.initials;
    article.querySelector('.rating').textContent='★ '+teacher.rating;
    article.querySelector('h3').textContent=teacher.name;
    article.querySelector('.role-label').textContent=teacher.role;
    const tagCount=article.classList.contains('main')?3:2;
    article.querySelector('.tags').innerHTML=teacher.tags.slice(0,tagCount).map(t=>'<span>'+t+'</span>').join('');
    article.querySelector('.price').innerHTML='₺'+teacher.price+' <small>/ ders</small>';
    article.querySelector('.card-body button').onclick=function(){
      window.location.href='teacher.html?id='+teacher.id;
    };
  }

  let tick=0;
  const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function renderTick(animate){
    const main=TEACHERS[tick%TEACHERS.length];
    const left=TEACHERS[(tick+1)%TEACHERS.length];
    const right=TEACHERS[(tick+2)%TEACHERS.length];
    const pairs=[[slots.left,left],[slots.main,main],[slots.right,right]];
    if(!animate||reduceMotion){
      pairs.forEach(([el,t])=>fillCard(el,t));
      return;
    }
    pairs.forEach(([el])=>el.classList.add('hero-fade'));
    setTimeout(()=>{
      pairs.forEach(([el,t])=>fillCard(el,t));
      pairs.forEach(([el])=>el.classList.remove('hero-fade'));
    },350);
  }

  renderTick(false);
  if(!reduceMotion){
    setInterval(()=>{
      tick++;
      renderTick(true);
    },10000);
  }
}
armusInitHeroRotator();
