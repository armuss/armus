document.querySelectorAll('[data-scroll]').forEach(btn=>{
  btn.addEventListener('click',()=>document.querySelector(btn.dataset.scroll)?.scrollIntoView({behavior:'smooth'}));
});
document.querySelectorAll('.filter').forEach(btn=>{
  btn.addEventListener('click',()=>{
    btn.classList.toggle('active');
  });
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
      window.location.href='teacher.html?teacher='+encodeURIComponent(teacher.id);
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

// Scroll-driven homepage intro: a single real lesson photo zooms in as
// the visitor scrolls through .scroll-intro-pin's tall runway, then
// crossfades into a mosaic of real ARMUS teacher photos (pulled from
// TEACHERS, teachers-data.js, so it never drifts out of sync with the
// actual demo roster) - "one lesson" becoming "hundreds of teachers".
// See the CSS comment above .scroll-intro-pin (index.html) for the
// pin/sticky mechanism itself. Every scroll-linked value here is set as
// a direct inline style, never a CSS transition, so it stays exactly
// locked to scroll position even on a fast flick or an instant jump.
function armusInitScrollIntro(){
  const pin=document.querySelector('.scroll-intro-pin');
  const singleImg=document.getElementById('introSingleImg');
  const layerSingle=document.getElementById('introLayerSingle');
  const layerMosaic=document.getElementById('introLayerMosaic');
  const mosaicGrid=document.getElementById('introMosaicGrid');
  const copySingle=document.getElementById('introCopySingle');
  const copyMosaic=document.getElementById('introCopyMosaic');
  if(!pin||!singleImg||!layerSingle||!layerMosaic||!mosaicGrid||!copySingle||!copyMosaic)return;

  // display:none under prefers-reduced-motion (index.html CSS) makes this
  // pointless work either way, but skip the scroll listener too rather
  // than just leaving it be - no reason to pay for it.
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;

  // appended, not innerHTML - mosaicGrid already holds the static .spark
  // decorative dots (index.html), and tiles need to paint after/above
  // them in DOM order for the scattered cluster's own z-index values to
  // make sense
  if(typeof TEACHERS!=='undefined'&&TEACHERS.length){
    mosaicGrid.insertAdjacentHTML('beforeend',TEACHERS.slice(0,6).map(t=>
      '<div class="tile"><img src="'+t.photo+'" alt="'+t.name+'" loading="lazy"></div>'
    ).join(''));
  }

  function smoothstep(edge0,edge1,x){
    const t=Math.min(1,Math.max(0,(x-edge0)/(edge1-edge0)));
    return t*t*(3-2*t);
  }

  let ticking=false;

  function update(){
    ticking=false;
    const rect=pin.getBoundingClientRect();
    const scrollable=rect.height-window.innerHeight;
    const progress=scrollable>0?Math.min(1,Math.max(0,-rect.top/scrollable)):0;

    // photo keeps zooming the whole first half, independent of the text
    // (which needs to fade out earlier, on its own, to stay readable)
    const zoomT=smoothstep(0,0.55,progress);
    singleImg.style.transform='scale('+(1+zoomT*0.45)+')';
    copySingle.style.opacity=String(1-smoothstep(0.12,0.34,progress));

    const cross=smoothstep(0.5,0.66,progress);
    layerSingle.style.opacity=String(1-cross);
    layerMosaic.style.opacity=String(cross);

    const settle=smoothstep(0.58,0.85,progress);
    mosaicGrid.style.transform='scale('+(1.12-settle*0.12)+')';
    copyMosaic.style.opacity=String(smoothstep(0.6,0.8,progress));
  }

  function onScroll(){
    if(ticking)return;
    ticking=true;
    requestAnimationFrame(update);
  }

  update();
  window.addEventListener('scroll',onScroll,{passive:true});
  window.addEventListener('resize',onScroll);
}
armusInitScrollIntro();

// Proof carousel: 3 stat/testimonial cards auto-cross-fade, with dots
// showing progress and doubling as manual controls.
function armusInitProofCarousel(){
  const photos=document.querySelectorAll('.proof-slide-photo');
  const facts=document.querySelectorAll('.proof-fact');
  const dots=document.querySelectorAll('.proof-dot');
  if(!photos.length)return;

  let index=0;

  function show(i){
    photos.forEach((p,n)=>p.classList.toggle('active',n===i));
    facts.forEach((f,n)=>f.classList.toggle('active',n===i));
    dots.forEach((d,n)=>d.classList.toggle('active',n===i));
    index=i;
  }

  dots.forEach((dot,n)=>dot.addEventListener('click',()=>show(n)));

  const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!reduceMotion){
    setInterval(()=>show((index+1)%photos.length),5000);
  }
}
armusInitProofCarousel();
