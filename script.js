/* ---------- fill in your own links here ---------- */
const ORCID_ID = "https://orcid.org/0009-0004-5512-1253";
const orcidUrl = ORCID_ID || "https://orcid.org/0009-0004-5512-1253";
document.querySelectorAll("#orcidLink, #orcidLink2").forEach(el => {
  el.href = orcidUrl;
  if (el.id === "orcidLink2") el.textContent = orcidUrl ? `ORCID → ${orcidUrl}` : "ORCID → https://orcid.org/0009-0004-5512-1253";
});

/* ---------- membrane + protein translocation canvas ----------
   A cargo polypeptide follows the cursor anywhere in the compartment.
   The bilayer is solid: the only way from the cis side to the trans side
   is to thread the chain through the transporter's channel. ------------- */
(() => {
  const canvas = document.getElementById("membraneCanvas");
  const frame = canvas.parentElement;
  const ctx = canvas.getContext("2d");
  const readout = document.getElementById("translocationReadout");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

  let W = 0, H = 0, tick = 0;
  let membraneY, thickness, transporterX, poreTop, poreBottom;

  // cargo chain
  const BEADS = 18;
  const SPACING = 11;   // backbone bond length
  const HEAD_R = 7;
  const BEAD_R = 5;
  const COHESION = 0.045; // hydrophobic collapse that folds the free chain
  const MIN_SEP = 12;     // excluded volume between non-bonded residues

  // transporter geometry
  const LOBE_W = 34;
  const CHANNEL_BASE = 12;
  const CHANNEL_OPEN = 8;   // extra bore width once the gate opens

  let gate = 0;             // 0 = closed, 1 = fully gated open

  function channelHalf() { return CHANNEL_BASE + CHANNEL_OPEN * gate; }
  function footprintHalf() { return channelHalf() + LOBE_W; }
  function bandHalf() { return thickness / 2 + 8; }

  function layout() {
    W = frame.clientWidth;
    H = canvas.clientHeight || 460;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    membraneY = H / 2;
    thickness = Math.min(80, H * 0.18);
    transporterX = W / 2;
    poreTop = membraneY - thickness / 2 - 14;
    poreBottom = membraneY + thickness / 2 + 14;
  }

  /* --- lipids: charged phosphate heads, gap where the transporter sits --- */
  let lipids = [];
  function buildLipids() {
    lipids = [];
    const spacing = 34;
    const count = Math.ceil(W / spacing) + 2;
    for (let i = 0; i < count; i++) {
      lipids.push({ x: -spacing + i * spacing, charge: Math.random() < 0.5 ? 1 : -1 });
    }
  }

  function drawLipidRow(y, dir) {
    const gap = footprintHalf() + 12;
    ctx.font = "8px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    lipids.forEach(l => {
      if (Math.abs(l.x - transporterX) < gap) return;

      // lipids near a blocked collision get nudged, showing the barrier holding
      const push = blocked.life > 0 ? Math.max(0, 1 - Math.abs(l.x - blocked.x) / 70) * blocked.life : 0;
      const headY = y - dir * push * 4;

      ctx.beginPath();
      ctx.moveTo(l.x, headY);
      ctx.lineTo(l.x, y + dir * 22);
      ctx.strokeStyle = "rgba(150,165,185,0.5)";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(l.x, headY, 7 + push * 1.5, 0, Math.PI * 2);
      ctx.fillStyle = l.charge > 0 ? "rgba(246,200,90,0.85)" : "rgba(111,180,255,0.85)";
      ctx.fill();
      ctx.strokeStyle = push > 0.05 ? `rgba(255,255,255,${0.15 + push * 0.5})` : "rgba(255,255,255,0.15)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = "#0b0f15";
      ctx.fillText(l.charge > 0 ? "+" : "–", l.x, headY + 0.5);
    });
  }

  /* --- the transporter: two lobes that splay apart as the gate opens --- */
  function drawTransporter() {
    const ch = channelHalf();
    const h = poreBottom - poreTop;

    ctx.save();
    ctx.shadowColor = `rgba(239,123,182,${0.25 + 0.35 * gate})`;
    ctx.shadowBlur = 14 + 16 * gate;
    [-1, 1].forEach(side => {
      const x = side < 0 ? transporterX - ch - LOBE_W : transporterX + ch;
      const grad = ctx.createLinearGradient(x, poreTop, x + LOBE_W, poreBottom);
      grad.addColorStop(0, "#b18bff");
      grad.addColorStop(1, "#ef7bb6");
      ctx.fillStyle = grad;
      roundRect(ctx, x, poreTop, LOBE_W, h, 15);
      ctx.fill();
    });
    ctx.restore();

    // vestibule mouths at each end of the channel
    ctx.strokeStyle = `rgba(255,255,255,${0.1 + 0.2 * gate})`;
    ctx.lineWidth = 2;
    [[poreTop, -1], [poreBottom, 1]].forEach(([y, dir]) => {
      ctx.beginPath();
      ctx.moveTo(transporterX - ch - 11, y + dir * 11);
      ctx.lineTo(transporterX - ch, y);
      ctx.moveTo(transporterX + ch, y);
      ctx.lineTo(transporterX + ch + 11, y + dir * 11);
      ctx.stroke();
    });
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  /* --- the bilayer as a solid barrier --------------------------------
     A bead may only occupy the membrane band while it is inside the
     channel bore; anywhere else it is pushed back to the side it came
     from, so the transporter is the only route across.               */
  const blocked = { x: 0, y: 0, life: 0 };

  function resolveMembrane(p, prev, r) {
    const bandTop = membraneY - bandHalf();
    const bandBottom = membraneY + bandHalf();
    if (p.y <= bandTop || p.y >= bandBottom) return false; // clear of the bilayer

    const bore = Math.max(3, channelHalf() - r);
    const inBore = Math.abs(p.x - transporterX) <= bore;
    const wasInBore = Math.abs(prev.x - transporterX) <= bore;

    if (inBore || wasInBore) {
      p.x = clamp(p.x, transporterX - bore, transporterX + bore); // solid channel walls
      return false;
    }
    p.y = prev.y <= membraneY ? bandTop : bandBottom;
    return true;
  }

  /* --- the cargo polypeptide: head follows the cursor, chain trails --- */
  let beads = [];
  function buildChain() {
    beads = [];
    const startY = membraneY - bandHalf() - 70;
    for (let i = 0; i < BEADS; i++) {
      beads.push({ x: transporterX - 130, y: startY - i * 2, px: transporterX - 130, py: startY });
    }
  }

  function idleTarget() {
    const a = tick * 0.005;
    return {
      x: transporterX + Math.cos(a) * Math.min(W * 0.24, 240),
      y: membraneY - bandHalf() - 60 - Math.sin(a * 1.4) * 28
    };
  }

  // a residue counts as threaded while it is inside the transporter itself,
  // which reaches a little beyond the lipid band at each vestibule
  function inChannelZone(b) {
    return b.y > poreTop - 8 && b.y < poreBottom + 8
      && Math.abs(b.x - transporterX) <= channelHalf() + 10;
  }

  let didBlock = false;
  function collideAll() {
    beads.forEach((b, i) => {
      b.x = clamp(b.x, 6, W - 6);
      b.y = clamp(b.y, 6, H - 6);
      if (resolveMembrane(b, { x: b.px, y: b.py }, i === 0 ? HEAD_R : BEAD_R)) {
        didBlock = true;
        if (i === 0) { blocked.x = b.x; blocked.y = b.y; blocked.life = 1; }
      }
    });
  }

  function stepChain() {
    const target = hasPointer ? mouse : idleTarget();
    const ease = hasPointer ? 0.2 : 0.02;
    didBlock = false;

    beads.forEach(b => { b.px = b.x; b.py = b.y; });

    // the leading residue follows the cursor
    const head = beads[0];
    head.x += (clamp(target.x, 10, W - 10) - head.x) * ease;
    head.y += (clamp(target.y, 10, H - 10) - head.y) * ease;

    beads.forEach(b => { b.inChannel = inChannelZone(b); });

    // fold centres: one per compartment, over the residues outside the channel
    let cisX = 0, cisY = 0, cisN = 0, trX = 0, trY = 0, trN = 0;
    beads.forEach(b => {
      if (b.inChannel) return;
      if (b.y < membraneY) { cisX += b.x; cisY += b.y; cisN++; }
      else { trX += b.x; trY += b.y; trN++; }
    });
    if (cisN) { cisX /= cisN; cisY /= cisN; }
    if (trN) { trX /= trN; trY /= trN; }

    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < BEADS; i++) {
        const b = beads[i], lead = beads[i - 1];

        // hold the backbone bond length
        const dx = lead.x - b.x, dy = lead.y - b.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const pull = (d - SPACING) * 0.5;
        b.x += (dx / d) * pull;
        b.y += (dy / d) * pull;

        if (b.inChannel) {
          // the narrow bore strips the fold: residues line up on the channel axis
          b.x += (transporterX - b.x) * 0.35;
        } else if (pass === 0) {
          // outside, the chain collapses back onto itself into a folded globule
          const onCis = b.y < membraneY;
          const n = onCis ? cisN : trN;
          if (n > 1) {
            b.x += ((onCis ? cisX : trX) - b.x) * COHESION;
            b.y += ((onCis ? cisY : trY) - b.y) * COHESION;
          }
          if (!reduceMotion) {
            b.x += (Math.random() - 0.5) * 0.4; // breaks symmetry so it packs, not rings
            b.y += (Math.random() - 0.5) * 0.4;
          }
        }
      }
      collideAll();
    }

    // excluded volume: gives the folded globule real bulk, so cohesion packs
    // the residues into a visible coil instead of crushing them onto a point
    for (let rep = 0; rep < 2; rep++) {
      for (let i = 0; i < BEADS; i++) {
        for (let j = i + 2; j < BEADS; j++) {
          const a = beads[i], b = beads[j];
          if (a.inChannel || b.inChannel) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > MIN_SEP * MIN_SEP || d2 < 1e-6) continue;
          const d = Math.sqrt(d2);
          const push = MIN_SEP - d;
          const ux = dx / d, uy = dy / d;
          if (i !== 0) { a.x -= ux * push * 0.5; a.y -= uy * push * 0.5; }
          b.x += ux * push * 0.5; b.y += uy * push * 0.5;
        }
      }
    }
    collideAll();

    if (!didBlock) blocked.life *= 0.88;
    if (blocked.life < 0.01) blocked.life = 0;
  }

  function threadedCount() {
    return beads.filter(b => b.inChannel).length;
  }

  function drawChain() {
    // backbone, smoothed through the bead midpoints
    ctx.beginPath();
    ctx.moveTo(beads[0].x, beads[0].y);
    for (let i = 1; i < BEADS - 1; i++) {
      ctx.quadraticCurveTo(beads[i].x, beads[i].y,
        (beads[i].x + beads[i + 1].x) / 2, (beads[i].y + beads[i + 1].y) / 2);
    }
    ctx.lineTo(beads[BEADS - 1].x, beads[BEADS - 1].y);
    ctx.strokeStyle = "rgba(127,232,196,0.55)";
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.stroke();

    beads.forEach((b, i) => {
      const threaded = b.inChannel;
      ctx.beginPath();
      ctx.arc(b.x, b.y, i === 0 ? HEAD_R : BEAD_R, 0, Math.PI * 2);
      ctx.fillStyle = threaded ? "rgba(180,255,225,0.98)"
        : i === 0 ? "rgba(246,168,108,0.95)" : "rgba(127,232,196,0.85)";
      ctx.shadowColor = threaded ? "rgba(127,232,196,0.8)" : "rgba(127,232,196,0.35)";
      ctx.shadowBlur = threaded ? 12 : 5;
      ctx.fill();
      ctx.shadowBlur = 0;
    });
  }

  /* --- ambient ions, confined to their own compartment --- */
  let ions = [];
  function buildIons() {
    ions = [];
    const topLimit = membraneY - thickness / 2 - 20;
    const bottomStart = membraneY + thickness / 2 + 20;
    for (let i = 0; i < 24; i++) {
      const top = Math.random() < 0.5;
      ions.push({
        x: Math.random() * W,
        y: top ? Math.random() * topLimit : bottomStart + Math.random() * (H - bottomStart),
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: 3 + Math.random() * 2,
        charge: Math.random() < 0.5 ? 1 : -1,
        top
      });
    }
  }

  function stepIon(ion) {
    if (reduceMotion) return;
    ion.x += ion.vx;
    ion.y += ion.vy;
    if (ion.x < 0 || ion.x > W) ion.vx *= -1;
    const topLimit = membraneY - thickness / 2 - 8;
    const bottomLimit = membraneY + thickness / 2 + 8;
    if (ion.top) {
      if (ion.y < 6 || ion.y > topLimit) ion.vy *= -1;
      ion.y = clamp(ion.y, 6, topLimit);
    } else {
      if (ion.y < bottomLimit || ion.y > H - 6) ion.vy *= -1;
      ion.y = clamp(ion.y, bottomLimit, H - 6);
    }
  }

  function drawIon(ion) {
    ctx.beginPath();
    ctx.arc(ion.x, ion.y, ion.r, 0, Math.PI * 2);
    ctx.fillStyle = ion.charge > 0 ? "rgba(246,200,90,0.7)" : "rgba(111,180,255,0.7)";
    ctx.fill();
  }

  /* --- pointer --- */
  const mouse = { x: 0, y: 0 };
  let hasPointer = false;

  function setMouseFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    mouse.x = src.clientX - rect.left;
    mouse.y = src.clientY - rect.top;
    hasPointer = true;
  }

  canvas.addEventListener("mousemove", setMouseFromEvent);
  canvas.addEventListener("touchmove", setMouseFromEvent, { passive: true });
  canvas.addEventListener("touchstart", setMouseFromEvent, { passive: true });
  canvas.addEventListener("mouseleave", () => { hasPointer = false; });

  /* --- gate: substrate-induced, opens as the cargo approaches --- */
  function stepGate(threaded) {
    const head = beads[0];
    const mouthY = head.y < membraneY ? poreTop : poreBottom;
    const dist = Math.hypot(head.x - transporterX, head.y - mouthY);
    const proximity = clamp(1 - dist / 130, 0, 1);
    const target = Math.max(proximity, threaded > 0 ? 1 : 0);
    gate += (target - gate) * 0.12;
  }

  function drawGuide() {
    if (gate < 0.02) return;
    const g = ctx.createLinearGradient(transporterX - 70, 0, transporterX + 70, 0);
    g.addColorStop(0, "rgba(127,232,196,0)");
    g.addColorStop(0.5, `rgba(127,232,196,${0.08 * gate})`);
    g.addColorStop(1, "rgba(127,232,196,0)");
    ctx.fillStyle = g;
    ctx.fillRect(transporterX - 70, 0, 140, H);
  }

  /* --- main loop --- */
  function frameLoop() {
    tick++;
    ctx.clearRect(0, 0, W, H);

    stepChain();
    const threaded = threadedCount();
    stepGate(threaded);

    drawGuide();
    ions.forEach(stepIon);
    ions.forEach(drawIon);

    drawLipidRow(membraneY - thickness / 2, 1);
    drawLipidRow(membraneY + thickness / 2, -1);
    drawTransporter();
    drawChain();

    if (readout) {
      const onTrans = beads[0].y > membraneY;
      readout.textContent = blocked.life > 0.4
        ? "blocked — the bilayer is impermeable"
        : threaded > 0
          ? `translocating — ${threaded} residue${threaded > 1 ? "s" : ""} in channel`
          : onTrans ? "trans side — translocated" : "cis side — outside the membrane";
    }

    requestAnimationFrame(frameLoop);
  }

  window.addEventListener("resize", () => { layout(); buildLipids(); buildIons(); });

  layout();
  buildLipids();
  buildIons();
  buildChain();
  frameLoop();
})();
