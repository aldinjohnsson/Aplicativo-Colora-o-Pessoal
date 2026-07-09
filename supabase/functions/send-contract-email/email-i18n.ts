// supabase/functions/send-contract-email/email-i18n.ts
//
// Dicionário de textos dos E-MAILS QUE VÃO PRA CLIENTE (contrato assinado,
// análise aprovada/rejeitada, resultado liberado, etc). Os e-mails que vão
// só pro ADMIN (notificação de nova assinatura, fotos pra revisar...)
// continuam sempre em português — quem lê é você, não a cliente.
//
// Espelha as chaves de src/lib/i18n/translations.ts (mesmo conceito), mas
// vive separado porque Edge Functions rodam em Deno e não importam do seu
// `src/` do front-end.

export type EmailLanguage = 'pt-BR' | 'en-US' | 'en-GB'

export function resolveEmailLanguage(value: unknown): EmailLanguage {
  return value === 'en-US' || value === 'en-GB' ? value : 'pt-BR'
}

function interpolate(template: string, vars?: Record<string, string>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, key) => (vars[key] !== undefined ? vars[key] : `{${key}}`))
}

export const EMAIL_TRANSLATIONS = {
  'pt-BR': {
    common: {
      greeting: 'Olá, <strong>{name}</strong>!',
      anyQuestions: 'Qualquer dúvida, entre em contato com a consultora.',
      deadlineTitle: '📅 Previsão de entrega',
      deadlineSub: 'Prazo calculado em dias úteis. Você receberá um aviso quando o resultado estiver pronto.',
      btnAccessFix: 'Acessar e corrigir',
      dateLocale: 'pt-BR',
    },
    contractSigned: {
      subject: 'Contrato de {plan}{brandSuffix}',
      title: 'Contrato Assinado',
      successTitle: '&#10003; Contrato assinado com sucesso!',
      successText: 'O PDF do contrato está anexo neste e-mail para seu registro.',
      labelPlan: 'Plano',
      labelName: 'Nome',
      labelEmail: 'E-mail',
      labelSignedAt: 'Assinado em',
      labelIp: 'IP',
      followPortal: 'Acompanhe o andamento da sua análise pelo portal:',
      btnAccessPortal: 'Acessar meu portal',
    },
    analysisApproved: {
      subject: 'Sua análise foi aprovada!{brandSuffix}',
      title: 'Análise em Andamento!',
      successTitle: '&#10003; Tudo certo! Sua análise foi aprovada.',
      successText: 'Suas fotos e formulário foram revisados e estão prontos para a análise de coloração.',
      followStatus: 'Acompanhe o status da sua análise pelo portal:',
      btnViewStatus: 'Ver status da minha análise',
    },
    analysisRejected: {
      subject: 'Ajuste necessário na sua análise{brandSuffix}',
      title: 'Ajuste Necessário',
      warnTitle: '&#9888;&#65039; Precisamos de um ajuste antes de continuar',
      warnText: 'Não se preocupe — seus dados estão salvos. Acesse o portal e ajuste apenas o que for solicitado abaixo.',
      photosAdjustLabel: '&#128247; Ajuste nas fotos',
      formAdjustLabel: '&#128203; Ajuste no formulário',
      goFix: 'Acesse o portal para realizar os ajustes:',
      afterFixNote: 'Após o ajuste, o envio será feito automaticamente para nova revisão.',
    },
    partialResultReleased: {
      subject: 'Prévia do seu resultado disponível{brandSuffix}',
      title: 'Prévia do seu Resultado',
      previewTitle: 'Sua prévia está disponível!',
      previewText: 'Acesse o portal para conferir o resultado parcial da sua análise.',
      stillWorkingTitle: '&#9203; Simulações ainda em andamento',
      stillWorkingSub: 'Nossa consultora ainda está finalizando os últimos detalhes. Você receberá um novo aviso assim que o resultado completo estiver pronto.',
      btnViewPreview: 'Ver minha prévia',
    },
    resultReleased: {
      subject: 'Sua análise {plan} está pronta!{brandSuffix}',
      title: 'Sua Análise {plan} está Pronta!',
      readyTitle: 'Sua análise {plan} está pronta!',
      readyText: 'Acesse o link abaixo para ver seu resultado completo.',
      btnViewResult: 'Ver meu resultado',
      thanksNote: 'Muito obrigada por me escolher para fazer parte dessa descoberta,<br>foi um prazer atender você. &#10084;&#65039;',
    },
    photosApproved: {
      subject: 'Suas fotos foram aprovadas!{brandSuffix}',
      title: 'Fotos Aprovadas!',
      successTitle: '&#10003; Suas fotos foram aprovadas!',
      successText: 'Tudo certo por aqui. Sua análise já está em andamento.',
      followPortal: 'Acompanhe o andamento da sua análise pelo portal:',
      btnFollow: 'Acompanhar minha análise',
    },
    photosRejected: {
      subject: 'Suas fotos precisam de um ajuste{brandSuffix}',
      title: 'Ajuste nas Fotos',
      warnTitle: '&#9888;&#65039; Precisamos de um ajuste nas suas fotos',
      warnText: 'Não se preocupe — suas fotos atuais estão salvas. Acesse o portal e substitua apenas o que for solicitado abaixo.',
      reasonLabel: '&#128247; Motivo do ajuste',
      goSendNew: 'Acesse o portal para enviar as novas fotos:',
      afterResendNote: 'Após o reenvio, suas fotos serão revisadas novamente.',
    },
    formRejected: {
      subject: 'Seu formulário precisa de um ajuste{brandSuffix}',
      title: 'Ajuste no Formulário',
      warnTitle: '&#9888;&#65039; Precisamos de um ajuste no seu formulário',
      warnText: 'Não se preocupe — seus dados estão salvos. Acesse o portal e corrija apenas o que for solicitado abaixo.',
      reasonLabel: '&#128203; Motivo do ajuste',
      goCorrect: 'Acesse o portal para realizar a correção:',
      afterCorrectNote: 'Após a correção, o formulário será reenviado automaticamente para revisão.',
    },
    bothRejected: {
      subject: 'Ajustes necessários na sua análise{brandSuffix}',
      title: 'Ajustes Necessários',
      warnTitle: '&#9888;&#65039; Precisamos de alguns ajustes antes de continuar',
      warnText: 'Não se preocupe — seus dados estão salvos. Acesse o portal e corrija apenas o que for solicitado abaixo.',
      photosAdjustLabel: '&#128247; Ajuste nas fotos',
      formAdjustLabel: '&#128203; Ajuste no formulário',
      goFix: 'Acesse o portal para realizar os ajustes:',
      afterFixNote: 'Após os ajustes, o envio será feito automaticamente para nova revisão.',
    },
  },

  'en-US': {
    common: {
      greeting: 'Hi, <strong>{name}</strong>!',
      anyQuestions: 'If you have any questions, contact your consultant.',
      deadlineTitle: '📅 Estimated delivery',
      deadlineSub: 'Timeframe calculated in business days. You will get a notice once your results are ready.',
      btnAccessFix: 'Go to portal and fix',
      dateLocale: 'en-US',
    },
    contractSigned: {
      subject: '{plan} contract{brandSuffix}',
      title: 'Contract Signed',
      successTitle: '&#10003; Contract signed successfully!',
      successText: 'The contract PDF is attached to this email for your records.',
      labelPlan: 'Plan',
      labelName: 'Name',
      labelEmail: 'Email',
      labelSignedAt: 'Signed on',
      labelIp: 'IP',
      followPortal: 'Track your analysis progress on the portal:',
      btnAccessPortal: 'Go to my portal',
    },
    analysisApproved: {
      subject: 'Your analysis was approved!{brandSuffix}',
      title: 'Analysis In Progress!',
      successTitle: '&#10003; All set! Your analysis was approved.',
      successText: 'Your photos and form have been reviewed and are ready for your color analysis.',
      followStatus: 'Track the status of your analysis on the portal:',
      btnViewStatus: 'View my analysis status',
    },
    analysisRejected: {
      subject: 'Your analysis needs an adjustment{brandSuffix}',
      title: 'Adjustment Needed',
      warnTitle: '&#9888;&#65039; We need an adjustment before continuing',
      warnText: "Don't worry — your data is saved. Go to the portal and adjust only what's requested below.",
      photosAdjustLabel: '&#128247; Adjustment on photos',
      formAdjustLabel: '&#128203; Adjustment on form',
      goFix: 'Go to the portal to make the adjustments:',
      afterFixNote: 'After the adjustment, it will be automatically sent for a new review.',
    },
    partialResultReleased: {
      subject: 'Your results preview is available{brandSuffix}',
      title: 'Your Results Preview',
      previewTitle: 'Your preview is available!',
      previewText: 'Go to the portal to check the partial results of your analysis.',
      stillWorkingTitle: '&#9203; Simulations still in progress',
      stillWorkingSub: "Your consultant is still finishing the last details. You'll get a new notice as soon as the full results are ready.",
      btnViewPreview: 'View my preview',
    },
    resultReleased: {
      subject: 'Your {plan} analysis is ready!{brandSuffix}',
      title: 'Your {plan} Analysis is Ready!',
      readyTitle: 'Your {plan} analysis is ready!',
      readyText: 'Follow the link below to see your full results.',
      btnViewResult: 'View my results',
      thanksNote: 'Thank you so much for choosing me for this discovery,<br>it was a pleasure working with you. &#10084;&#65039;',
    },
    photosApproved: {
      subject: 'Your photos were approved!{brandSuffix}',
      title: 'Photos Approved!',
      successTitle: '&#10003; Your photos were approved!',
      successText: "You're all set. Your analysis is already in progress.",
      followPortal: 'Track your analysis progress on the portal:',
      btnFollow: 'Track my analysis',
    },
    photosRejected: {
      subject: 'Your photos need an adjustment{brandSuffix}',
      title: 'Photo Adjustment',
      warnTitle: '&#9888;&#65039; We need an adjustment on your photos',
      warnText: "Don't worry — your current photos are saved. Go to the portal and replace only what's requested below.",
      reasonLabel: '&#128247; Reason for the adjustment',
      goSendNew: 'Go to the portal to send the new photos:',
      afterResendNote: 'After resubmitting, your photos will be reviewed again.',
    },
    formRejected: {
      subject: 'Your form needs an adjustment{brandSuffix}',
      title: 'Form Adjustment',
      warnTitle: '&#9888;&#65039; We need an adjustment on your form',
      warnText: "Don't worry — your data is saved. Go to the portal and fix only what's requested below.",
      reasonLabel: '&#128203; Reason for the adjustment',
      goCorrect: 'Go to the portal to make the correction:',
      afterCorrectNote: 'After the correction, the form will be automatically resent for review.',
    },
    bothRejected: {
      subject: 'Adjustments needed on your analysis{brandSuffix}',
      title: 'Adjustments Needed',
      warnTitle: '&#9888;&#65039; We need a few adjustments before continuing',
      warnText: "Don't worry — your data is saved. Go to the portal and fix only what's requested below.",
      photosAdjustLabel: '&#128247; Adjustment on photos',
      formAdjustLabel: '&#128203; Adjustment on form',
      goFix: 'Go to the portal to make the adjustments:',
      afterFixNote: 'After the adjustments, it will be automatically sent for a new review.',
    },
  },

  'en-GB': {
    common: {
      greeting: 'Hi, <strong>{name}</strong>!',
      anyQuestions: 'If you have any questions, contact your consultant.',
      deadlineTitle: '📅 Estimated delivery',
      deadlineSub: 'Timeframe calculated in working days. You will get a notice once your results are ready.',
      btnAccessFix: 'Go to portal and fix',
      dateLocale: 'en-GB',
    },
    contractSigned: {
      subject: '{plan} contract{brandSuffix}',
      title: 'Contract Signed',
      successTitle: '&#10003; Contract signed successfully!',
      successText: 'The contract PDF is attached to this email for your records.',
      labelPlan: 'Plan',
      labelName: 'Name',
      labelEmail: 'Email',
      labelSignedAt: 'Signed on',
      labelIp: 'IP',
      followPortal: 'Track your analysis progress on the portal:',
      btnAccessPortal: 'Go to my portal',
    },
    analysisApproved: {
      subject: 'Your analysis was approved!{brandSuffix}',
      title: 'Analysis In Progress!',
      successTitle: '&#10003; All set! Your analysis was approved.',
      successText: 'Your photos and form have been reviewed and are ready for your colour analysis.',
      followStatus: 'Track the status of your analysis on the portal:',
      btnViewStatus: 'View my analysis status',
    },
    analysisRejected: {
      subject: 'Your analysis needs an adjustment{brandSuffix}',
      title: 'Adjustment Needed',
      warnTitle: '&#9888;&#65039; We need an adjustment before continuing',
      warnText: "Don't worry — your data is saved. Go to the portal and adjust only what's requested below.",
      photosAdjustLabel: '&#128247; Adjustment on photos',
      formAdjustLabel: '&#128203; Adjustment on form',
      goFix: 'Go to the portal to make the adjustments:',
      afterFixNote: 'After the adjustment, it will be automatically sent for a new review.',
    },
    partialResultReleased: {
      subject: 'Your results preview is available{brandSuffix}',
      title: 'Your Results Preview',
      previewTitle: 'Your preview is available!',
      previewText: 'Go to the portal to check the partial results of your analysis.',
      stillWorkingTitle: '&#9203; Simulations still in progress',
      stillWorkingSub: "Your consultant is still finishing the last details. You'll get a new notice as soon as the full results are ready.",
      btnViewPreview: 'View my preview',
    },
    resultReleased: {
      subject: 'Your {plan} analysis is ready!{brandSuffix}',
      title: 'Your {plan} Analysis is Ready!',
      readyTitle: 'Your {plan} analysis is ready!',
      readyText: 'Follow the link below to see your full results.',
      btnViewResult: 'View my results',
      thanksNote: 'Thank you so much for choosing me for this discovery,<br>it was a pleasure working with you. &#10084;&#65039;',
    },
    photosApproved: {
      subject: 'Your photos were approved!{brandSuffix}',
      title: 'Photos Approved!',
      successTitle: '&#10003; Your photos were approved!',
      successText: "You're all set. Your analysis is already in progress.",
      followPortal: 'Track your analysis progress on the portal:',
      btnFollow: 'Track my analysis',
    },
    photosRejected: {
      subject: 'Your photos need an adjustment{brandSuffix}',
      title: 'Photo Adjustment',
      warnTitle: '&#9888;&#65039; We need an adjustment on your photos',
      warnText: "Don't worry — your current photos are saved. Go to the portal and replace only what's requested below.",
      reasonLabel: '&#128247; Reason for the adjustment',
      goSendNew: 'Go to the portal to send the new photos:',
      afterResendNote: 'After resubmitting, your photos will be reviewed again.',
    },
    formRejected: {
      subject: 'Your form needs an adjustment{brandSuffix}',
      title: 'Form Adjustment',
      warnTitle: '&#9888;&#65039; We need an adjustment on your form',
      warnText: "Don't worry — your data is saved. Go to the portal and fix only what's requested below.",
      reasonLabel: '&#128203; Reason for the adjustment',
      goCorrect: 'Go to the portal to make the correction:',
      afterCorrectNote: 'After the correction, the form will be automatically resent for review.',
    },
    bothRejected: {
      subject: 'Adjustments needed on your analysis{brandSuffix}',
      title: 'Adjustments Needed',
      warnTitle: '&#9888;&#65039; We need a few adjustments before continuing',
      warnText: "Don't worry — your data is saved. Go to the portal and fix only what's requested below.",
      photosAdjustLabel: '&#128247; Adjustment on photos',
      formAdjustLabel: '&#128203; Adjustment on form',
      goFix: 'Go to the portal to make the adjustments:',
      afterFixNote: 'After the adjustments, it will be automatically sent for a new review.',
    },
  },
} as const

type Dict = typeof EMAIL_TRANSLATIONS['pt-BR']

/** Busca `t(lang, 'contractSigned.subject', { plan: 'Plano 1' })` com fallback pt-BR. */
export function t(
  lang: EmailLanguage,
  key: string,
  vars?: Record<string, string>
): string {
  const dict = (EMAIL_TRANSLATIONS[lang] ?? EMAIL_TRANSLATIONS['pt-BR']) as Dict
  const fallback = EMAIL_TRANSLATIONS['pt-BR'] as Dict
  const [section, field] = key.split('.') as [keyof Dict, string]
  const value =
    (dict[section] as any)?.[field] ??
    (fallback[section] as any)?.[field] ??
    key
  return interpolate(value, vars)
}
