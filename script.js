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

// Scroll-driven homepage intro: one authored video (classroom -> dust
// transition -> teacher cards settling into place, all baked in by the
// person who made it) scrubbed by setting its currentTime straight off
// scroll position as the visitor scrolls through .scroll-intro-pin's tall
// runway - the video never plays on its own. See the CSS comment above
// .scroll-intro-pin (index.html) for the pin/sticky mechanism itself.
// Every scroll-linked value here is set as a direct inline style/property,
// never a CSS transition, so it stays exactly locked to scroll position
// even on a fast flick or an instant jump.
function armusInitScrollIntro(){
  const pin=document.querySelector('.scroll-intro-pin');
  const introVideo=document.getElementById('introSingleImg');
  const nav=document.querySelector('header.nav');
  if(!pin||!introVideo)return;

  // display:none under prefers-reduced-motion (index.html CSS) makes this
  // pointless work either way, but skip the scroll listener too rather
  // than just leaving it be - no reason to pay for it.
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;

  function smoothstep(edge0,edge1,x){
    const t=Math.min(1,Math.max(0,(x-edge0)/(edge1-edge0)));
    return t*t*(3-2*t);
  }

  let ticking=false;
  // duration is 0 until the video's metadata has loaded - on a fast/local
  // connection that can already have happened by the time this script
  // runs (preload="auto" starts the fetch the instant the <video> tag is
  // parsed, well before script.js at the bottom of the page even
  // executes), so 'loadedmetadata' alone would never fire again and it
  // would silently stay stuck at 0. Checking readyState synchronously
  // covers that case; the event covers the normal case where it hasn't
  // loaded yet.
  let videoDuration=introVideo.duration||0;
  introVideo.addEventListener('loadedmetadata',()=>{videoDuration=introVideo.duration||0;});

  function update(){
    ticking=false;
    const rect=pin.getBoundingClientRect();
    const scrollable=rect.height-window.innerHeight;
    const progress=scrollable>0?Math.min(1,Math.max(0,-rect.top/scrollable)):0;

    // the whole clip (classroom -> dust transition -> cards settling) is
    // scrubbed across most of the scroll range, holding on its own final
    // frame (already the same gold as .hero-band right below) for the
    // rest of the scroll - no fade needed, the two colors already meet
    // cleanly, and fading to transparent here used to flash the stage's
    // own black background through mid-fade, which read as a jarring
    // black cut rather than a continuous shot.
    let scrubT=0;
    if(videoDuration){
      scrubT=smoothstep(0,0.85,progress);
      const target=scrubT*videoDuration;
      if(Math.abs(introVideo.currentTime-target)>0.02)introVideo.currentTime=target;
    }

    // once the clip has reached its own settled ending (cards in place),
    // give the whole shot a very slight, slow wobble - the individual
    // per-card wobble from the old DOM-built cluster can't carry over now
    // that the cards are pixels baked into this video rather than
    // separate elements, so this is the closest equivalent: a gentle
    // breathing/sway on the frame as a whole, not held perfectly still.
    introVideo.classList.toggle('is-settled',scrubT>=1);

    // the floating nav (header.nav, every page) would otherwise sit on
    // top of this whole sequence throughout - fades out fast once
    // scrolling into the pin starts, and stays gone until the stage
    // actually leaves the top of the viewport: progress caps at 1 while
    // the sticky stage still fills the whole viewport (rect.bottom ===
    // innerHeight at that point), so waiting on progress alone would
    // bring the nav back too early. Instead it tracks rect.bottom
    // directly through the extra scroll after unstick.
    if(nav){
      const navHideOut=smoothstep(0,0.08,progress);
      const navRevealIn=smoothstep(window.innerHeight*0.2,0,rect.bottom);
      const navOpacity=Math.min(1,(1-navHideOut)+navRevealIn);
      nav.style.opacity=String(navOpacity);
      nav.style.pointerEvents=navOpacity<0.5?'none':'auto';
    }
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
