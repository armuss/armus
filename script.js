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

// Scroll-driven video (between .hero-band and .proof): scrubs a single
// video's currentTime straight off scroll position as the visitor scrolls
// through .scroll-video-pin's tall runway - the video never plays on its
// own. See the CSS comment above .scroll-video-pin (index.html) for the
// pin/sticky mechanism itself. Every scroll-linked value here is set as a
// direct inline style/property, never a CSS transition, so it stays
// exactly locked to scroll position even on a fast flick or an instant
// jump.
function armusInitScrollVideo(){
  const pin=document.querySelector('.scroll-video-pin');
  const video=document.getElementById('scrollVideoEl');
  const stage=document.querySelector('.scroll-video-stage');
  const endcard=document.getElementById('scrollVideoEndcard');
  const fade=document.getElementById('scrollVideoFade');
  const nav=document.querySelector('header.nav');
  if(!pin||!video)return;

  // display:none under prefers-reduced-motion (index.html CSS) makes this
  // pointless work either way, but skip the scroll listener too rather
  // than just leaving it be - no reason to pay for it.
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;

  function smoothstep(edge0,edge1,x){
    const t=Math.min(1,Math.max(0,(x-edge0)/(edge1-edge0)));
    return t*t*(3-2*t);
  }

  // --scroll-video-edge-color feeds both #scrollVideoFade and
  // .scroll-video-spacer's gradients (index.html CSS) - set on :root so
  // both can read it. This samples that color for real, straight off the
  // video's own visible bottom edge, instead of guessing a fixed value
  // that would only match one particular frame. Replicates the same crop
  // math object-fit:cover applies (the video is never letterboxed, so
  // what's visually at the bottom of the viewport is a cropped region of
  // the source frame, not the whole thing) to find the right source
  // coordinates, draws a thin strip of just that edge into a tiny
  // offscreen canvas, and averages it into one color.
  const root=document.documentElement;
  let edgeCanvas,edgeCtx;
  function sampleEdgeColor(){
    if(!stage||!video.videoWidth||!video.videoHeight)return;
    if(!edgeCanvas){
      edgeCanvas=document.createElement('canvas');
      edgeCanvas.width=8;
      edgeCanvas.height=1;
      edgeCtx=edgeCanvas.getContext('2d');
    }
    const cw=stage.clientWidth,ch=stage.clientHeight;
    const vw=video.videoWidth,vh=video.videoHeight;
    const scale=Math.max(cw/vw,ch/vh);
    const sw=cw/scale,sh=ch/scale;
    const sx=(vw-sw)/2,sy=(vh-sh)/2;
    const stripH=Math.max(1,sh*0.02);
    try{
      edgeCtx.drawImage(video,sx,sy+sh-stripH,sw,stripH,0,0,8,1);
      const data=edgeCtx.getImageData(0,0,8,1).data;
      let r=0,g=0,b=0;
      for(let i=0;i<8;i++){r+=data[i*4];g+=data[i*4+1];b+=data[i*4+2];}
      root.style.setProperty('--scroll-video-edge-color','rgb('+Math.round(r/8)+','+Math.round(g/8)+','+Math.round(b/8)+')');
    }catch(e){
      // same-origin video, this shouldn't throw - but if it ever does,
      // the CSS fallback (var(--armus-gold-3)) just keeps applying.
    }
  }
  video.addEventListener('seeked',sampleEdgeColor);
  video.addEventListener('loadeddata',sampleEdgeColor);

  let ticking=false;
  // duration is 0 until the video's metadata has loaded - on a fast/local
  // connection that can already have happened by the time this script
  // runs (preload="auto" starts the fetch the instant the <video> tag is
  // parsed, well before script.js at the bottom of the page even
  // executes), so 'loadedmetadata' alone would never fire again and it
  // would silently stay stuck at 0. Checking readyState synchronously
  // covers that case; the event covers the normal case where it hasn't
  // loaded yet.
  let videoDuration=video.duration||0;
  video.addEventListener('loadedmetadata',()=>{videoDuration=video.duration||0;});

  function update(){
    ticking=false;
    const rect=pin.getBoundingClientRect();
    const scrollable=rect.height-window.innerHeight;
    const progress=scrollable>0?Math.min(1,Math.max(0,-rect.top/scrollable)):0;

    // the whole clip is scrubbed across most of the scroll range, holding
    // on its own final frame (the teacher cards settling into place) for
    // the rest of the scroll.
    //
    // video.seeking guard: a single seek takes tens of ms to decode, while
    // scroll fires this update every ~16ms. Without the guard, a fast
    // scroll/flick queues a new seek before the last one finishes, and the
    // video visibly freezes trying to work through the backlog. Skipping
    // the assignment while a seek is still in flight means the next free
    // frame jumps straight to wherever the scroll actually is by then,
    // instead of grinding through every position in between.
    if(videoDuration&&!video.seeking){
      const scrubT=smoothstep(0,0.85,progress);
      const target=scrubT*videoDuration;
      if(Math.abs(video.currentTime-target)>0.02)video.currentTime=target;
    }

    // #scrollVideoEndcard (index.html CSS) replaces the video once it's
    // already settled on its own matching final frame (which happens by
    // progress 0.85, above) - object-fit:contain guarantees this
    // supplied image shows every card complete, unlike the video's own
    // object-fit:cover which can crop them on some viewport shapes. A
    // gradual opacity crossfade was tried first, but the video (cropped,
    // effectively zoomed in) and the endcard (contain-fit, zoomed out to
    // stay whole) are at different scales - blending them mid-fade
    // produced a double-exposure ghosting effect, not a clean dissolve.
    // A hard cut avoids that entirely; it lands while the video is
    // already static on its held final frame, so there's no motion to
    // interrupt.
    if(endcard)endcard.style.opacity=progress>=0.96?'1':'0';

    // #scrollVideoFade (index.html CSS) only needs to be visible right as
    // the video settles on its ending frame and is about to hand off to
    // .scroll-video-spacer below - for the rest of the scroll it stays
    // fully transparent so it never covers the video's real content.
    if(fade)fade.style.opacity=String(smoothstep(0.88,1,progress));

    // the floating nav (header.nav, every page) would otherwise sit on
    // top of this section throughout - fades out fast once scrolling into the pin
    // starts, and stays gone until the stage actually leaves the top of
    // the viewport: progress caps at 1 while the sticky stage still fills
    // the whole viewport (rect.bottom === innerHeight at that point), so
    // waiting on progress alone would bring the nav back too early.
    // Instead it tracks rect.bottom directly through the extra scroll
    // after unstick.
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

  sampleEdgeColor();
  update();
  window.addEventListener('scroll',onScroll,{passive:true});
  window.addEventListener('resize',onScroll);
  window.addEventListener('resize',sampleEdgeColor);
}
armusInitScrollVideo();

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
