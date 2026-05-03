import { useEffect } from 'react'
import { gsap } from 'gsap'
import { ScrollSmoother } from 'gsap/ScrollSmoother'
import { Nav } from './components/Nav'
import { Hero } from './components/Hero'
import { ExploreCluster, QueryCluster, ResultsCluster, ModifyCluster } from './components/features'
import { Privacy } from './components/Privacy'
import { Limitations } from './components/Limitations'
import { Compare } from './components/Compare'
import { FAQ } from './components/FAQ'
import { Footer } from './components/Footer'

export default function App() {
  useEffect(() => {
    const mm = gsap.matchMedia()

    mm.add('(min-width: 768px) and (prefers-reduced-motion: no-preference)', () => {
      const smoother = ScrollSmoother.create({
        wrapper: '#smooth-wrapper',
        content: '#smooth-content',
        smooth: 1.2,
        effects: true,
      })
      return () => smoother.kill()
    })

    return () => mm.revert()
  }, [])

  return (
    <>
      {/* Nav lives outside the scroll container so position:fixed isn't clobbered by GSAP transforms */}
      <Nav />

      <div id="smooth-wrapper">
        <div id="smooth-content" className="relative min-h-screen bg-[#0a0a0f] text-[#ededf0] overflow-x-hidden">
          <main>
            <Hero />
            <section id="features">
              <ExploreCluster />
              <QueryCluster />
              <ResultsCluster />
              <ModifyCluster />
            </section>
            <section id="privacy">
              <Privacy />
            </section>
            <section id="scope">
              <Limitations />
            </section>
            <section id="compare">
              <Compare />
            </section>
            <section id="faq">
              <FAQ />
            </section>
          </main>
          <Footer />
        </div>
      </div>
    </>
  )
}
