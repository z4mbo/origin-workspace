"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowDown, ArrowRight, ArrowUpRight, Archive, Check, ChevronDown, Columns3, GitBranch, Menu, MessageCircle, PenTool, ShieldCheck, Users, Video, X } from "lucide-react";
import styles from "./landing-page.module.css";

const views = [
  { id: "issues", name: "Issues", icon: Columns3, title: "Your workflow. Not somebody else's.", description: "A board that follows your workflow, from the first idea to the finished work.", image: "/landing/issues.png", mobile: "/landing/issues-mobile.png", alt: "Origin project board with assigned issues, priorities and completed work" },
  { id: "chat", name: "Chat", icon: MessageCircle, title: "The conversation stays with the work.", description: "A shared conversation for the team. Private messages for the details. Files and issue references, right where you need them.", image: "/landing/chat.png", mobile: "/landing/chat-mobile.png", alt: "An Origin team conversation with timestamps, replies and a linked project issue" },
  { id: "draw", name: "Draw", icon: PenTool, title: "Good ideas rarely start in a straight line.", description: "An open canvas for the rough sketches, quick flows, and small breakthroughs.", image: "/landing/draw.png", mobile: "/landing/draw-mobile.png", alt: "A shared Origin canvas with an onboarding flow and wireframe prototypes" },
] as const;

const questions = [
  { question: "Is Origin open source?", answer: "Yes. Origin is an MIT-licensed public beta. Use the hosted workspace or run your own Node server with a Convex backend. The source and setup guide are on GitHub; your workspace content stays private." },
  { question: "What else is in the workspace?", answer: "An issue calendar, project assets, an encrypted vault, and a feedback tab for each project. Turn feedback or chat messages into assigned issues, attach images and files, and connect the work to GitHub." },
  { question: "What is Origin?", answer: "Origin is a shared workspace for people making things together. Projects, issues, team conversations, calls, and a collaborative canvas live in the same place." },
  { question: "Can I bring my team?", answer: "Yes. Create a named workspace, then share an invitation link. You can choose who manages the workspace, who can contribute, and who has read-only access." },
  { question: "What happens when an issue is done?", answer: "Completed issues appear in the project's Completed section, grouped by their original column. Your active board stays focused, and you can find or restore completed work at any time." },
  { question: "Can we draw while we're on a call?", answer: "Yes. Your call stays connected when you switch to Draw. Sketch together on the shared canvas, or share your screen to walk through the details." },
  { question: "Does it work on my phone?", answer: "Yes. Check your issues, catch up on messages, and open the shared canvas from your mobile browser. Your workspace stays the same across devices." },
];

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const [pastHero, setPastHero] = useState(false);
  const heroRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    const observer = new IntersectionObserver(([entry]) => setPastHero(!entry.isIntersecting), { rootMargin: "-80px 0px 0px 0px" });
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = views[selected];
  const selectWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % views.length;
    else if (event.key === "ArrowLeft") next = (index + views.length - 1) % views.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = views.length - 1;
    else return;
    event.preventDefault(); setSelected(next); tabRefs.current[next]?.focus();
  };
  return <div className={styles.page}>
    <a className={styles.skipLink} href="#main">Skip to content</a>
    <a className={styles.announcement} href="https://github.com/z4mbo/origin-workspace" target="_blank" rel="noreferrer"><span>Open-source public beta</span><span>Explore the code. Build with us.</span><ArrowRight size={14} /></a>
    <header className={`${styles.header} ${pastHero ? styles.lightHeader : ""} ${menuOpen ? styles.openHeader : ""}`} onKeyDown={event => { if (event.key === "Escape") { setMenuOpen(false); document.getElementById("landing-menu-toggle")?.focus(); } }}>
      <nav className={styles.nav} aria-label="Main navigation">
        <Link className={styles.brand} href="/" aria-label="Origin home">Origin</Link>
        <div className={styles.desktopLinks}><a href="#workspace">Product</a><a href="#together">For your team</a><a href="#github">GitHub<ChevronDown size={12} /></a><a href="#questions">Questions</a></div>
        <div className={styles.navActions}><Link className={styles.signIn} href="/login">Sign in</Link><Link className={`${styles.button} ${styles.navCta}`} href="/signup">Create workspace<ArrowRight size={15} /></Link><button id="landing-menu-toggle" type="button" className={styles.menuToggle} aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} aria-controls="landing-mobile-menu" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={21} /> : <Menu size={21} />}</button></div>
      </nav>
      {menuOpen && <nav id="landing-mobile-menu" className={styles.mobileMenu} aria-label="Mobile navigation"><a href="#workspace" onClick={() => setMenuOpen(false)}>Workspace</a><a href="#together" onClick={() => setMenuOpen(false)}>For your team</a><a href="#questions" onClick={() => setMenuOpen(false)}>Questions</a><Link className={styles.button} href="/signup">Create workspace<ArrowRight size={16} /></Link></nav>}
    </header>
    <main id="main">
      <section ref={heroRef} className={styles.hero} aria-labelledby="origin-title">
        <Image className={styles.heroScene} src="/landing/stone.webp" fill priority sizes="100vw" alt="" />
        <div className={styles.heroCopy}>
          <h1 id="origin-title">Origin<br /><span>Team workspace.</span></h1>
          <div className={styles.heroSupport}><p>Your projects, conversations, and ideas.<br />One place for your team to turn them into something real.</p><Link className={styles.button} href="/signup">Create your workspace<ArrowUpRight size={16} /></Link></div>
        </div>
        <a className={styles.heroScroll} href="#workspace" aria-label="Explore the Origin workspace"><ArrowDown size={18} /></a>
      </section>

      <section className={styles.overview} aria-labelledby="overview-title"><h2 id="overview-title">A shared home for everything you're building.</h2><div className={styles.toolBand} aria-label="Your workspace"><span><Columns3 size={23} />Projects & issues</span><span><MessageCircle size={23} />Chat & DMs</span><span><Video size={23} />Calls</span><span><PenTool size={23} />Draw</span><span><GitBranch size={23} />GitHub</span><span><Archive size={23} />Completed work</span></div></section>
      <section id="workspace" className={styles.productSection} aria-labelledby="workspace-title">
        <div className={styles.productHeading}><h2 id="workspace-title">The workspace behind<br />your next great project.</h2><p>A little less switching. A lot more making.</p></div>
        <div className={styles.tourTabs} role="tablist" aria-label="Explore Origin">{views.map((view, index) => <button key={view.id} ref={element => { tabRefs.current[index] = element; }} id={`tour-tab-${view.id}`} role="tab" aria-selected={selected === index} aria-controls="tour-panel" tabIndex={selected === index ? 0 : -1} type="button" onClick={() => setSelected(index)} onKeyDown={event => selectWithKeyboard(event, index)}><view.icon size={18} /><span>{view.name}</span><ArrowRight className={styles.tabArrow} size={16} /></button>)}</div>
        <div id="tour-panel" role="tabpanel" aria-labelledby={`tour-tab-${current.id}`} tabIndex={0} className={styles.tourPanel}>
          <div className={styles.tourCaption}><h3>{current.title}</h3><p>{current.description}</p></div>
          <div className={styles.productImage}><Image key={current.image} className={styles.desktopImage} src={current.image} width={1440} height={820} alt={current.alt} sizes="(max-width: 1200px) 100vw, 1200px" /><Image key={current.mobile} className={styles.mobileImage} src={current.mobile} width={390} height={760} alt={current.alt} sizes="(max-width: 640px) 100vw, 1px" /></div>
        </div>
        <div className={styles.connectedTools}><span><Video size={16} />Calls & screen sharing</span><span><GitBranch size={16} />Repositories & pull requests</span><span><Archive size={16} />A home for finished work</span></div>
      </section>

      <section className={styles.statement}><p>All your projects in one place.<br />The people and conversations behind them.<br /><span>And a little more room to build.</span></p></section>
      <section id="github" className={styles.githubSection} aria-labelledby="github-title">
        <div className={styles.sectionHeading}><h2 id="github-title">An issue here.<br />A solution over there.</h2><p>Keep planning in Origin and development in GitHub.<br />Connected, without the double bookkeeping.</p></div>
        <div className={styles.githubFlow}>
          <div><Columns3 size={24} /><h3>Plan in Origin</h3><p>Create an issue. Set the priority, owner, and due date.</p></div>
          <ArrowRight size={20} aria-hidden="true" />
          <div><GitBranch size={24} /><h3>Build in GitHub</h3><p>Create the linked GitHub issue and work on the repository with your preferred tools.</p></div>
          <ArrowRight size={20} aria-hidden="true" />
          <div><Check size={24} /><h3>Close it once</h3><p>Close the issue on GitHub. Origin moves it into completed work.</p></div>
        </div>
      </section>
      <section id="together" className={styles.teamSection} aria-labelledby="team-title">
        <div className={styles.teamIntro}><div className={styles.teamAvatars} aria-hidden="true"><span>A</span><span>S</span><span>R</span><span><Users size={21} /></span></div><h2 id="team-title">A place that feels<br />like your team.</h2><p>Give it a name. Invite your people.<br />Make room for what you&apos;re building.</p><Link className={styles.textLink} href="/signup">Find your Origin<ArrowRight size={16} /></Link></div>
        <div className={styles.teamDetails}><div className={styles.address}><span>origin.imbored.fun/</span><strong>your-team</strong><Check size={17} /></div><div className={styles.teamDetail}><Users size={20} /><div><h3>A workspace that belongs to you</h3><p>One shared home for your projects and the people behind them.</p></div></div><div className={styles.teamDetail}><ShieldCheck size={20} /><div><h3>The right people, the right access</h3><p>Invite collaborators with a link. Give each person a role that fits.</p></div></div><div className={styles.teamDetail}><PenTool size={20} /><div><h3>Space for the unfinished</h3><p>A rough sketch, an open question, a half-formed idea. Start there.</p></div></div></div>
      </section>

      <section id="questions" className={styles.faqSection} aria-labelledby="questions-title"><h2 id="questions-title">Questions?</h2><div className={styles.questions}>{questions.map(({ question, answer }) => <details key={question}><summary>{question}<ChevronDown size={18} /></summary><p>{answer}</p></details>)}</div></section>
      <section className={styles.closing}><Image className={styles.closingImage} src="/landing/stone.webp" fill sizes="100vw" alt="" /><div><h2>Your next project<br />starts at Origin.</h2><p>Give it a name. Invite your team. Make it happen.</p><Link className={styles.button} href="/signup">Create your workspace<ArrowUpRight size={16} /></Link></div></section>
    </main>
    <footer className={styles.footer}><Link className={styles.brand} href="/" aria-label="Origin home">Origin</Link><p>A place to make things together.</p><a href="#main">Back to top<ArrowRight size={14} /></a></footer>
  </div>;
}
