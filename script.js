document.querySelectorAll('[data-scroll]').forEach(btn=>{
  btn.addEventListener('click',()=>document.querySelector(btn.dataset.scroll)?.scrollIntoView({behavior:'smooth'}));
});
document.querySelectorAll('.filter').forEach(btn=>{
  btn.addEventListener('click',()=>{
    btn.classList.toggle('active');
  });
});

// Scroll-triggered reveal: elements marked .reveal fade/slide in once
// they enter the viewport (desktop), or get scrubbed 1:1 with the
// scroll gesture itself on a phone (see armusInitScrollScrubReveal).
function armusInitScrollReveal(){
  const targets=document.querySelectorAll('.reveal');
  if(!targets.length)return;
  const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduceMotion||!('IntersectionObserver' in window)){
    targets.forEach(el=>el.classList.add('in-view'));
    return;
  }
  const isMobile=window.matchMedia('(max-width: 900px)').matches;
  if(isMobile){
    armusInitScrollScrubReveal(targets);
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

// Ties each .reveal element's opacity/translateY directly to how far its
// top has crossed a window near the bottom of the viewport, recomputed
// every scroll tick - no CSS transition involved, so there's no fixed
// duration/easing fighting the gesture: scroll down and it animates in
// in lockstep with the finger, scroll back up and it animates back out.
// Deliberately plain scroll+rAF instead of CSS scroll-driven animations
// (animation-timeline: view()) since that's still unsupported on some
// Android browsers still in real use (notably older Samsung Internet).
function armusInitScrollScrubReveal(targets){
  const list=Array.from(targets);
  const START=0.92; // element's top at 92% down the viewport -> progress 0
  const END=0.55;   // element's top at 55% down the viewport -> progress 1
  let ticking=false;

  function apply(el){
    const vh=window.innerHeight;
    const startY=vh*START;
    const endY=vh*END;
    const top=el.getBoundingClientRect().top;
    let progress=(startY-top)/(startY-endY);
    progress=Math.max(0,Math.min(1,progress));
    el.style.opacity=String(progress);
    el.style.transform='translateY('+((1-progress)*36)+'px)';
  }

  // Recomputing getBoundingClientRect for every .reveal target on every
  // single scroll frame, for the whole page's lifetime, was real jank on
  // real phones once a page had a dozen-plus of them - most are nowhere
  // near the viewport at any given moment. An IntersectionObserver with a
  // generous rootMargin tracks which ones are close enough to matter
  // (browser-native, no per-frame layout read), so the scroll handler
  // below only ever touches that small active set instead of every
  // target on the page.
  //
  // No synchronous apply() call up front on the full list - deliberately
  // left to the observer's own initial notification (it reports every
  // newly-observed target's current state within the next frame or two,
  // no visible delay). That initial notification is also what makes this
  // correct for a target like .steps' mobile card carousel, where a card
  // can sit well past the viewport's *vertical* threshold yet still be
  // clipped out of view by its own horizontally-scrolling ancestor - the
  // observer accounts for that ancestor clipping, a raw
  // getBoundingClientRect() top does not. Writing an inline style from
  // an upfront getBoundingClientRect() pass would have fought the CSS
  // that intentionally forces those cards to stay opacity:1 at that
  // breakpoint (see .steps article.reveal, styles.css) - skip the pre-
  // call and a card the observer never reports as intersecting simply
  // never gets an inline style, leaving that CSS override in full effect.
  let active=[];
  const nearObserver=new IntersectionObserver(entries=>{
    entries.forEach(entry=>{
      if(entry.isIntersecting){
        if(!active.includes(entry.target))active.push(entry.target);
        apply(entry.target);
      }else{
        active=active.filter(el=>el!==entry.target);
      }
    });
  },{rootMargin:'50% 0px 50% 0px'});
  list.forEach(el=>nearObserver.observe(el));

  function update(){
    ticking=false;
    active.forEach(apply);
  }

  function onScroll(){
    if(ticking)return;
    ticking=true;
    requestAnimationFrame(update);
  }

  window.addEventListener('scroll',onScroll,{passive:true});
  window.addEventListener('resize',onScroll);
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
  // the whole stack is display:none on phones (replaced by
  // .hero-mobile-photo), so there's nothing to animate there
  const isMobile=window.matchMedia('(max-width: 900px)').matches;
  if(reduceMotion||isMobile)return;

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
      window.location.href='teacher?teacher='+encodeURIComponent(teacher.id);
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
