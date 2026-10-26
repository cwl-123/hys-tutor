const $ = (selector) => document.querySelector(selector)
const $$ = (selector) => Array.from(document.querySelectorAll(selector))
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value))
const smooth = (value) => {
  const p = clamp(value)
  return p * p * (3 - 2 * p)
}
const ease = (value) => 1 - Math.pow(1 - clamp(value), 3)
const mix = (from, to, value) => from + (to - from) * value

let timeline
let heroNodes = []
let heroEdges = []

function reveal(element, local, delay = 0, distance = 24, duration = 0.7) {
  if (!element) return 0
  const p = ease((local - delay) / duration)
  element.style.opacity = String(p)
  element.style.transform = `translate3d(0, ${(1 - p) * distance}px, 0)`
  return p
}

function createHeroGraph() {
  const namespace = 'http://www.w3.org/2000/svg'
  const nodes = [
    { x: 320, y: 300, label: '学习方向', color: '#8585f2' },
    { x: 150, y: 182, label: '概念', color: '#4ade80' },
    { x: 490, y: 176, label: '案例', color: '#8585f2' },
    { x: 142, y: 424, label: '练习', color: '#fbbf24' },
    { x: 492, y: 426, label: '反馈', color: '#fb7185' },
    { x: 320, y: 538, label: '下一课', color: '#4ade80' },
    { x: 320, y: 76, label: '偏好', color: '#8585f2' },
  ]
  const edges = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 6], [2, 6], [3, 5], [4, 5], [1, 3], [2, 4]]
  const edgeGroup = $('#heroEdges')
  const nodeGroup = $('#heroNodes')
  heroEdges = edges.map(([from, to]) => {
    const line = document.createElementNS(namespace, 'line')
    line.setAttribute('x1', String(nodes[from].x))
    line.setAttribute('y1', String(nodes[from].y))
    line.setAttribute('x2', String(nodes[to].x))
    line.setAttribute('y2', String(nodes[to].y))
    line.setAttribute('class', 'hero-edge')
    line.style.strokeDasharray = '360'
    edgeGroup.appendChild(line)
    return line
  })
  heroNodes = nodes.map((node) => {
    const group = document.createElementNS(namespace, 'g')
    group.setAttribute('class', 'hero-node')
    const glow = document.createElementNS(namespace, 'circle')
    glow.setAttribute('cx', String(node.x))
    glow.setAttribute('cy', String(node.y))
    glow.setAttribute('r', '45')
    glow.setAttribute('fill', node.color)
    glow.setAttribute('opacity', '0.07')
    const circle = document.createElementNS(namespace, 'circle')
    circle.setAttribute('cx', String(node.x))
    circle.setAttribute('cy', String(node.y))
    circle.setAttribute('r', '35')
    circle.setAttribute('fill', '#14182a')
    circle.setAttribute('stroke', node.color)
    const text = document.createElementNS(namespace, 'text')
    text.setAttribute('x', String(node.x))
    text.setAttribute('y', String(node.y + 5))
    text.textContent = node.label
    group.append(glow, circle, text)
    nodeGroup.appendChild(group)
    return group
  })
}

function renderHero(local, globalTime) {
  heroNodes.forEach((node, index) => {
    const p = smooth((local - 0.55 - index * 0.2) / 0.65)
    node.style.opacity = String(p)
  })
  heroEdges.forEach((edge, index) => {
    const p = smooth((local - 1.1 - index * 0.11) / 0.8)
    edge.style.opacity = String(p * 0.9)
    edge.style.strokeDashoffset = String(360 * (1 - p))
  })
  $$('.hero__orbit').forEach((orbit, index) => {
    orbit.style.transformOrigin = '320px 320px'
    orbit.style.transform = `rotate(${globalTime * (index ? -2.2 : 1.6)}deg)`
  })
  $('#heroScoreValue').textContent = String(Math.round(mix(0, 90, smooth((local - 2.1) / 2.2))))
}

function renderHook(local, duration, globalTime) {
  reveal($('#hookEyebrow'), local, 0.1, 14)
  reveal($('#hookProduct'), local, 0.35, 20)
  reveal($('#hookTitle'), local, 0.65, 32, 0.9)
  reveal($('#hookLead'), local, 1.1, 24)
  reveal($('#hookTags'), local, 1.5, 18)
  const hero = $('#hero')
  const p = ease((local - 0.25) / 1.1)
  hero.style.opacity = String(p)
  hero.style.transform = `translate3d(${(1 - p) * 45}px, 0, 0) scale(${0.96 + p * 0.04})`
  reveal($('#heroScore'), local, 2.15, 20)
  reveal($('#heroNext'), local, 2.75, 18)
  renderHero(local, globalTime ?? duration)
}

function renderProblem(local) {
  reveal($('#problemEyebrow'), local, 0.1, 14)
  reveal($('#problemTitle'), local, 0.3, 28)
  reveal($('#problemLead'), local, 0.75, 20)
  $$('[data-problem-card]').forEach((card, index) => {
    const element = card
    const p = ease((local - 0.45 - index * 0.48) / 0.75)
    element.style.opacity = String(p)
    element.style.transform = `translate3d(${(1 - p) * 48}px, 0, 0)`
    const strike = smooth((local - 1.8 - index * 0.34) / 0.45)
    element.querySelector('i').style.width = `${strike * 245}px`
    element.querySelector('b').style.opacity = String(strike)
  })
  reveal($('#memoryCard'), local, 3.25, 24, 0.8)
}

function renderOnboard(local) {
  reveal($('#onboardEyebrow'), local, 0.1, 14)
  reveal($('#onboardTitle'), local, 0.3, 28)
  reveal($('#onboardLead'), local, 0.75, 20)
  $$('[data-step]').forEach((step, index) => reveal(step, local, 1.2 + index * 0.72, 18))
  const visual = $('#onboardVisual')
  const p = ease((local - 0.35) / 1)
  visual.style.opacity = String(p)
  visual.style.transform = `translate3d(${(1 - p) * 45}px, 0, 0)`
  $('#onboardImage').style.transform = `scale(${1.025 + local * 0.0015}) translate3d(0, ${-local * 0.8}px, 0)`
  reveal($('#researchChip'), local, 2.1, 18)
  reveal($('#profileChip'), local, 3.05, 18)
}

function renderGraph(local) {
  reveal($('#graphEyebrow'), local, 0.1, 14)
  reveal($('#graphTitle'), local, 0.3, 28)
  reveal($('#graphLegend'), local, 0.9, 18)
  reveal($('#scheduleCard'), local, 1.4, 24)
  const visual = $('#graphVisual')
  const p = ease((local - 0.3) / 1)
  visual.style.opacity = String(p)
  visual.style.transform = `translate3d(${(1 - p) * 45}px, 0, 0)`
  const panel = smooth((local - 6.15) / 0.8)
  $('#graphPanelImage').style.opacity = String(panel)
  $('#graphImage').style.transform = `scale(${1.025 + local * 0.002}) translate3d(${-local * 0.55}px, ${-local * 0.35}px, 0)`
  $('#graphPanelImage').style.transform = `scale(${1.025 + local * 0.002}) translate3d(${-local * 0.55}px, ${-local * 0.35}px, 0)`
  reveal($('#graphBadge'), local, 6.55, 18)
}

function renderLesson(local) {
  reveal($('#lessonEyebrow'), local, 0.1, 14)
  reveal($('#lessonTitle'), local, 0.3, 25)
  reveal($('#lessonTags'), local, 0.85, 18)
  const visual = $('#lessonVisual')
  const p = ease((local - 0.25) / 0.9)
  visual.style.opacity = String(p)
  visual.style.transform = `translate3d(0, ${(1 - p) * 35}px, 0)`
  const toSecond = smooth((local - 3.75) / 0.75)
  const toThird = smooth((local - 8.05) / 0.75)
  const shots = $$('[data-lesson-shot]')
  shots[0].style.opacity = String(1 - toSecond)
  shots[1].style.opacity = String(toSecond * (1 - toThird))
  shots[2].style.opacity = String(toThird)
  shots.forEach((shot, index) => {
    const localShot = Math.max(0, local - index * 4)
    shot.style.transform = `scale(${1.035 + localShot * 0.0015}) translate3d(0, ${-localShot * (index + 1) * 0.7}px, 0)`
  })
  reveal($('#preferencePill'), local, 1.45, 18)
  reveal($('#lessonTools'), local, 5.05, 18)
}

function renderPractice(local) {
  reveal($('#practiceEyebrow'), local, 0.1, 14)
  reveal($('#practiceTitle'), local, 0.3, 28)
  reveal($('#questionTypes'), local, 0.9, 20)
  reveal($('#gradingList'), local, 1.35, 20)
  const visual = $('#practiceVisual')
  const p = ease((local - 0.3) / 1)
  visual.style.opacity = String(p)
  visual.style.transform = `translate3d(${(1 - p) * 45}px, 0, 0)`
  const mastery = smooth((local - 4.25) / 0.75)
  $('#masteryImage').style.opacity = String(mastery)
  $('#practiceImage').style.transform = `scale(${1.025 + local * 0.0018}) translate3d(0, ${-local * 0.6}px, 0)`
  $('#masteryImage').style.transform = `scale(${1.025 + local * 0.0018}) translate3d(0, ${-local * 0.6}px, 0)`
  reveal($('#scorePop'), local, 4.85, 20)
}

function positionLoopNodes() {
  $$('[data-loop-node]').forEach((node, index) => {
    const angle = (-90 + index * 72) * Math.PI / 180
    node.style.left = `${315 + Math.cos(angle) * 240}px`
    node.style.top = `${315 + Math.sin(angle) * 240}px`
  })
}

function renderLoop(local, duration) {
  reveal($('#loopEyebrow'), local, 0.1, 14)
  reveal($('#loopTitle'), local, 0.3, 25)
  const diagram = $('#loopDiagram')
  const p = ease((local - 0.35) / 0.9)
  diagram.style.opacity = String(p)
  diagram.style.transform = `scale(${0.95 + p * 0.05})`
  const progress = clamp((local - 0.75) / Math.max(1, duration - 1.5))
  $('#loopProgress').style.strokeDashoffset = String(1539 * (1 - progress))
  const active = Math.min(4, Math.floor(progress * 5))
  $$('[data-loop-node]').forEach((node, index) => {
    const nodeReveal = ease((local - 0.65 - index * 0.32) / 0.55)
    const isActive = index === active && local > 1.2
    node.style.opacity = String(nodeReveal)
    node.style.transform = `scale(${nodeReveal * (isActive ? 1.1 : 1)})`
    node.style.borderColor = isActive ? 'rgba(133,133,242,.7)' : 'rgba(255,255,255,.14)'
    node.style.background = isActive ? 'rgba(64,60,125,.94)' : 'rgba(19,22,37,.94)'
    node.style.boxShadow = isActive ? '0 0 38px rgba(133,133,242,.28)' : '0 15px 35px rgba(0,0,0,.28)'
  })
  const centerP = ease((local - 0.65) / 0.8)
  $('#loopCenter').style.opacity = String(centerP)
  $('#loopCenter').style.transform = `translate(-50%, -50%) scale(${0.92 + centerP * 0.08})`
  reveal($('#loopCaption'), local, 4.15, 18)
}

function renderClose(local) {
  reveal($('#closeLogo'), local, 0.15, 18)
  reveal($('#closeWordmark'), local, 0.4, 16)
  reveal($('#closeTitle'), local, 0.7, 30, 0.9)
  reveal($('#closeLead'), local, 1.25, 20)
  reveal($('#closePills'), local, 1.7, 18)
  const glow = $('.close__glow')
  const p = ease(local / 1.4)
  glow.style.opacity = String(p)
  glow.style.transform = `translate(-50%, -50%) scale(${0.85 + p * 0.15})`
}

const renderers = {
  hook: renderHook,
  problem: renderProblem,
  onboard: renderOnboard,
  graph: renderGraph,
  lesson: renderLesson,
  practice: renderPractice,
  loop: renderLoop,
  close: renderClose,
}

function renderAt(time) {
  if (!timeline) return
  const t = clamp(time, 0, timeline.total)
  let activeIndex = timeline.scenes.findIndex((scene) => t >= scene.start && t < scene.end)
  if (activeIndex < 0) activeIndex = timeline.scenes.length - 1
  const activeScene = timeline.scenes[activeIndex]
  $$('[data-scene]').forEach((element) => {
    const scene = timeline.scenes.find((item) => item.id === element.dataset.scene)
    const local = clamp(t - scene.start, 0, scene.end - scene.start)
    const duration = scene.end - scene.start
    const isActive = element.dataset.scene === activeScene.id
    const enter = smooth(local / 0.55)
    const exit = scene.id === 'close' ? 1 : smooth((duration - local) / 0.42)
    element.style.opacity = isActive ? String(Math.min(enter, exit)) : '0'
    element.style.transform = isActive ? `translate3d(0, ${(1 - enter) * 14}px, 0)` : 'translate3d(0, 12px, 0)'
  })
  const local = t - activeScene.start
  renderers[activeScene.id](local, activeScene.end - activeScene.start, t)
  $('#hudIndex').textContent = `${String(activeIndex + 1).padStart(2, '0')} / ${String(timeline.scenes.length).padStart(2, '0')}`
  $('#progressBar').style.width = `${clamp(t / timeline.total) * 100}%`
  $('#orbOne').style.transform = `translate3d(${Math.sin(t * 0.12) * 35}px, ${Math.cos(t * 0.1) * 25}px, 0)`
  $('#orbTwo').style.transform = `translate3d(${Math.cos(t * 0.09) * 40}px, ${Math.sin(t * 0.11) * 28}px, 0)`
  const caption = timeline.captions.find((item) => t >= item.start && t < item.end)
  const subtitle = $('#subtitle')
  if (caption) {
    subtitle.textContent = caption.text
    const captionOpacity = Math.min(smooth((t - caption.start) / 0.12), smooth((caption.end - t) / 0.16))
    subtitle.style.opacity = String(captionOpacity)
  } else {
    subtitle.style.opacity = '0'
  }
  return { scene: activeScene.id, local, total: timeline.total }
}

async function initialize() {
  const response = await fetch('./timeline.json')
  timeline = await response.json()
  document.title = timeline.title
  createHeroGraph()
  positionLoopNodes()
  await Promise.all($$('img').map((image) => image.decode()))
  await document.fonts.ready
  window.renderAt = renderAt
  window.videoTimeline = timeline
  window.videoReady = true
  renderAt(0)
}

initialize().catch((error) => {
  window.videoError = String(error?.stack || error)
  console.error(error)
})
