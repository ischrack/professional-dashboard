import React, { useState } from 'react'
import { Shuffle, ArrowRight } from 'lucide-react'
import clsx from 'clsx'
import type { CodeLearningIntakeForm } from '@shared/types'

const LANGUAGE_OPTIONS = ['Python', 'R', 'Bash', 'SQL', 'Nextflow', 'Snakemake', 'Airflow', 'Mixed']

const EXPERIENCE_OPTIONS: Array<{ value: CodeLearningIntakeForm['experienceLevel']; label: string }> = [
  { value: 'new', label: 'New to this' },
  { value: 'some', label: 'Some experience' },
  { value: 'comfortable', label: 'Comfortable, want depth' },
]

const TIME_OPTIONS: Array<{ value: CodeLearningIntakeForm['timeEstimate']; label: string }> = [
  { value: '2h', label: '~2 hours' },
  { value: 'half_day', label: 'Half a day' },
  { value: 'few_days', label: 'A few days' },
  { value: 'week_plus', label: 'A week or more' },
]

const ARTIFACT_OPTIONS: Array<{ value: CodeLearningIntakeForm['outputArtifact']; label: string }> = [
  { value: 'cli_tool', label: 'CLI tool' },
  { value: 'nextflow_pipeline', label: 'Nextflow pipeline' },
  { value: 'snakemake_workflow', label: 'Snakemake workflow' },
  { value: 'r_package', label: 'R package' },
  { value: 'analysis_notebook', label: 'Analysis notebook' },
  { value: 'data_dashboard', label: 'Data dashboard' },
  { value: 'no_preference', label: 'No preference' },
]

const SURPRISE_IDEAS = [
  {
    goalText: "I want to build a Nextflow pipeline that runs differential expression analysis on bulk RNA-seq data using STAR for alignment and DESeq2 for DE analysis",
    languages: ['Nextflow', 'R', 'Bash'],
  },
  {
    goalText: "I want to write a Python CLI tool that downloads scRNA-seq data from GEO, runs a scanpy analysis, and outputs a UMAP plot and cluster marker table",
    languages: ['Python', 'Bash'],
  },
  {
    goalText: "I want to build a Snakemake workflow for somatic variant calling from WGS tumor/normal pairs following GATK best practices",
    languages: ['Snakemake', 'Python', 'Bash'],
  },
  {
    goalText: "I want to create an R analysis script for single-cell RNA-seq data using Seurat, covering QC, normalization, clustering, and marker gene identification",
    languages: ['R'],
  },
  {
    goalText: "I want to build a SQL-backed pipeline that organizes patient metadata and genomic results for a clinical cohort, with query scripts for common analyses",
    languages: ['SQL', 'Python'],
  },
]

const DEFAULT_FORM: CodeLearningIntakeForm = {
  goalText: '',
  languages: [],
  experienceLevel: 'some',
  timeEstimate: 'few_days',
  outputArtifact: 'no_preference',
}

interface IntakeFormProps {
  initialValues?: Partial<CodeLearningIntakeForm>
  onSubmit: (form: CodeLearningIntakeForm) => void
  isLoading?: boolean
}

export default function IntakeForm({ initialValues, onSubmit, isLoading = false }: IntakeFormProps) {
  const [form, setForm] = useState<CodeLearningIntakeForm>({ ...DEFAULT_FORM, ...initialValues })

  function toggleLanguage(lang: string) {
    setForm(prev => ({
      ...prev,
      languages: prev.languages.includes(lang)
        ? prev.languages.filter(l => l !== lang)
        : [...prev.languages, lang],
    }))
  }

  function handleSurpriseMe() {
    const idea = SURPRISE_IDEAS[Math.floor(Math.random() * SURPRISE_IDEAS.length)]
    setForm(prev => ({ ...prev, goalText: idea.goalText, languages: idea.languages }))
  }

  const canSubmit = form.languages.length > 0

  return (
    <div className="space-y-6">

      {/* Goal text */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold text-text-dim uppercase tracking-wider">
            What do you want to build or learn?
            <span className="ml-1.5 font-normal normal-case text-text-dim">(optional)</span>
          </label>
          <button onClick={handleSurpriseMe} className="btn-ghost text-xs py-1 px-2">
            <Shuffle size={12} />
            Surprise me
          </button>
        </div>
        <textarea
          value={form.goalText}
          onChange={e => setForm(prev => ({ ...prev, goalText: e.target.value }))}
          className="input resize-none"
          rows={3}
          placeholder="e.g. I want to build a Nextflow pipeline that runs differential expression analysis on bulk RNA-seq data…"
        />
      </div>

      {/* Languages — required */}
      <div>
        <label className="block text-xs font-semibold text-text-dim uppercase tracking-wider mb-2">
          Language / Tool Target
          <span className="ml-1 text-error">*</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {LANGUAGE_OPTIONS.map(lang => (
            <button
              key={lang}
              onClick={() => toggleLanguage(lang)}
              className={clsx(
                'px-3 py-1.5 rounded-full text-xs font-medium transition-colors border',
                form.languages.includes(lang)
                  ? 'bg-accent/20 text-accent border-accent/50'
                  : 'bg-surface-2 text-text-muted border-border hover:border-accent/30 hover:text-text',
              )}
            >
              {lang}
            </button>
          ))}
        </div>
      </div>

      {/* Experience level */}
      <div>
        <label className="block text-xs font-semibold text-text-dim uppercase tracking-wider mb-2">
          Experience level with these tools
        </label>
        <div className="grid grid-cols-3 gap-2">
          {EXPERIENCE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setForm(prev => ({ ...prev, experienceLevel: opt.value }))}
              className={clsx(
                'p-2.5 rounded-lg border-2 text-sm font-medium transition-colors',
                form.experienceLevel === opt.value
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border text-text-muted hover:border-border/60 hover:text-text hover:bg-surface-2',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Time estimate */}
      <div>
        <label className="block text-xs font-semibold text-text-dim uppercase tracking-wider mb-2">
          Estimated time available
        </label>
        <div className="grid grid-cols-4 gap-2">
          {TIME_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setForm(prev => ({ ...prev, timeEstimate: opt.value }))}
              className={clsx(
                'p-2.5 rounded-lg border-2 text-sm font-medium transition-colors',
                form.timeEstimate === opt.value
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border text-text-muted hover:border-border/60 hover:text-text hover:bg-surface-2',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Output artifact — optional */}
      <div>
        <label className="block text-xs font-semibold text-text-dim uppercase tracking-wider mb-2">
          Preferred output artifact
          <span className="ml-1.5 font-normal normal-case text-text-dim">(optional)</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {ARTIFACT_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setForm(prev => ({ ...prev, outputArtifact: opt.value }))}
              className={clsx(
                'px-3 py-1.5 rounded-full text-xs font-medium transition-colors border',
                form.outputArtifact === opt.value
                  ? 'bg-accent/20 text-accent border-accent/50'
                  : 'bg-surface-2 text-text-muted border-border hover:border-accent/30 hover:text-text',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Submit */}
      <div className="pt-1 space-y-2">
        <button
          onClick={() => canSubmit && !isLoading && onSubmit(form)}
          disabled={!canSubmit || isLoading}
          className="btn-primary w-full justify-center"
        >
          <ArrowRight size={14} />
          {isLoading ? 'Generating Proposal…' : 'Generate Project Proposal'}
        </button>
        {!canSubmit && (
          <p className="text-xs text-text-dim text-center">
            Select at least one language to continue
          </p>
        )}
      </div>

    </div>
  )
}
