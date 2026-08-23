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

// Hero teacher-stack carousel: 4 persistent card elements cycle through
// the roles left -> main -> right -> hidden(stage) -> left ... every 10s.
// The left and main cards physically slide into the next slot (no content
// swap, so the motion is a smooth transform/opacity glide, not a fade of
// text); the right card fades out as it leaves, and the hidden staging
// card - already holding the next teacher's info - fades in to take the
// left spot. Content is only ever rewritten on a card while it's fully
// hidden (opacity 0), so nothing flashes mid-slide.
function armusInitHeroRotator(){
  const stack=document.querySelector('.teacher-stack');
  if(!stack||typeof TEACHERS==='undefined'||!TEACHERS.length)return;
  const cardEls=Array.from(stack.querySelectorAll('.teacher-card'));
  if(cardEls.length<4)return;

  const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduceMotion)return;

  function fillCard(article,teacher){
    const portrait=article.querySelector('.portrait');
    portrait.className='portrait portrait-'+teacher.id;
    portrait.innerHTML=teacher.photo
      ? '<img src="'+teacher.photo+'" alt="">'
      : teacher.initials;
    article.querySelector('.rating').textContent='★ '+teacher.rating;
    article.querySelector('h3').textContent=teacher.name;
    article.querySelector('.role-label').textContent=teacher.role;
    article.querySelector('.tags').innerHTML=teacher.tags.slice(0,3).map(t=>'<span>'+t+'</span>').join('');
    article.querySelector('.price').innerHTML='₺'+teacher.price+' <small>/ ders</small>';
    article.querySelector('.card-body button').onclick=function(){
      window.location.href='teacher.html?id='+teacher.id;
    };
  }

  const roles=['left','main','right','stage'];
  // roleOrder[k] = index into cardEls currently holding roles[k]; matches
  // the pos-left/pos-main/pos-right/pos-stage classes already in the HTML.
  let roleOrder=[0,1,2,3];
  let nextTeacherIndex=4%TEACHERS.length;

  function applyRoles(){
    roleOrder.forEach((elIndex,roleIdx)=>{
      cardEls[elIndex].className='teacher-card pos-'+roles[roleIdx];
    });
  }

  setInterval(()=>{
    const outgoingIndex=roleOrder[2]; // currently 'right', about to fade to 'stage'
    roleOrder=[roleOrder[3],roleOrder[0],roleOrder[1],roleOrder[2]];
    applyRoles();
    // wait for the fade-out to finish before swapping its content, so the
    // retiring card never visibly flashes new text while still in view
    setTimeout(()=>{
      fillCard(cardEls[outgoingIndex],TEACHERS[nextTeacherIndex%TEACHERS.length]);
      nextTeacherIndex++;
    },1050);
  },10000);
}
armusInitHeroRotator();
