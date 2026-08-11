"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, LockKeyhole, Search, Users } from "lucide-react";

import { PageContainer } from "@/components/page-container";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.05 },
  },
};

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
};

export default function HomePage() {
  return (
    <PageContainer>
      <motion.section
        variants={container}
        initial="hidden"
        animate="show"
        className="mx-auto flex max-w-3xl flex-col items-center text-center"
      >
        <motion.div variants={item}>
          <Badge
            variant="secondary"
            className="rounded-full px-3 py-1 text-xs font-medium"
          >
            CareerHub UK
          </Badge>
        </motion.div>

        <motion.h1
          variants={item}
          className="mt-5 text-balance text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl"
        >
          Find UK employers faster
        </motion.h1>

        <motion.p
          variants={item}
          className="mt-4 max-w-xl text-pretty text-lg text-muted-foreground"
        >
          Search companies and jobs, or manage outreach as a coach.
        </motion.p>
      </motion.section>

      <motion.section
        variants={container}
        initial="hidden"
        animate="show"
        className="mx-auto mt-12 grid max-w-4xl gap-6 sm:mt-16 md:grid-cols-2"
      >
        {/* Student card */}
        <motion.article
          variants={item}
          whileHover={{ y: -4 }}
          transition={{ type: "spring", stiffness: 300, damping: 24 }}
          className="flex flex-col justify-between gap-6 rounded-3xl border border-border bg-card p-8 shadow-sm transition-shadow hover:shadow-md"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Search className="size-6" />
              </span>
              <Badge className="rounded-full">Public</Badge>
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold tracking-tight">
                For students
              </h2>
              <p className="text-sm text-muted-foreground">
                Browse UK companies and open roles, filter by location and
                sector, and jump straight to careers pages — no account needed.
              </p>
            </div>
          </div>
          <Button asChild size="lg" className="w-full rounded-xl">
            <Link href="/search">
              Search jobs
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </motion.article>

        {/* Coach card */}
        <motion.article
          variants={item}
          whileHover={{ y: -4 }}
          transition={{ type: "spring", stiffness: 300, damping: 24 }}
          className="flex flex-col justify-between gap-6 rounded-3xl border border-border bg-card p-8 shadow-sm transition-shadow hover:shadow-md"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-foreground">
                <Users className="size-6" />
              </span>
              <Badge variant="secondary" className="rounded-full gap-1">
                <LockKeyhole className="size-3" />
                Private
              </Badge>
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold tracking-tight">
                For coaches
              </h2>
              <p className="text-sm text-muted-foreground">
                Track leads, prioritise employers by score, and manage student
                outreach in a dedicated workspace. Coming soon.
              </p>
            </div>
          </div>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="w-full rounded-xl"
          >
            <Link href="/coach/login">
              Coach login
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </motion.article>
      </motion.section>
    </PageContainer>
  );
}
