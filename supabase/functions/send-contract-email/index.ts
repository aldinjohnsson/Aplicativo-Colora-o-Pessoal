// supabase/functions/send-contract-email/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1'
// ── i18n dos e-mails (inline — sem depender de outro arquivo no deploy) ─────
//
// Conteudo do que antes era email-i18n.ts, colado direto aqui para evitar
// o erro 'Module not found' quando o deploy so envia um arquivo por vez.

export type EmailLanguage = 'pt-BR' | 'en-US' | 'en-GB' | 'es-ES' | 'fr-FR' | 'it-IT' | 'de-DE'

const VALID_EMAIL_LANGUAGES: EmailLanguage[] = ['pt-BR', 'en-US', 'en-GB', 'es-ES', 'fr-FR', 'it-IT', 'de-DE']

export function resolveEmailLanguage(value: unknown): EmailLanguage {
  return (VALID_EMAIL_LANGUAGES as unknown[]).includes(value) ? (value as EmailLanguage) : 'pt-BR'
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
    pdfContract: {
      defaultTitle: 'Contrato de Prestação de Serviços',
      contractorSection: 'CONTRATANTE',
      planLabel: 'Plano',
      signedBadge: '[ASSINADO]  Aceito digitalmente por {name}',
      onDate: 'em {datetime}',
      atSeparator: 'às',
      emailLabel: 'E-mail',
      ipLabel: 'IP do signatario',
      handwrittenSignature: 'Assinatura manuscrita digital:',
      signatureFallback: 'Assinatura',
      confirmationText: 'O contratante declara ter lido, compreendido e aceito todos os termos e condicoes deste contrato.',
      pageOf: 'Pagina {current} de {total}',
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
    pdfContract: {
      defaultTitle: 'Service Agreement',
      contractorSection: 'CLIENT',
      planLabel: 'Plan',
      signedBadge: '[SIGNED]  Digitally accepted by {name}',
      onDate: 'on {datetime}',
      atSeparator: 'at',
      emailLabel: 'Email',
      ipLabel: 'Signatory IP',
      handwrittenSignature: 'Digital handwritten signature:',
      signatureFallback: 'Signature',
      confirmationText: 'The client declares having read, understood, and accepted all terms and conditions of this contract.',
      pageOf: 'Page {current} of {total}',
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
    pdfContract: {
      defaultTitle: 'Service Agreement',
      contractorSection: 'CLIENT',
      planLabel: 'Plan',
      signedBadge: '[SIGNED]  Digitally accepted by {name}',
      onDate: 'on {datetime}',
      atSeparator: 'at',
      emailLabel: 'Email',
      ipLabel: 'Signatory IP',
      handwrittenSignature: 'Digital handwritten signature:',
      signatureFallback: 'Signature',
      confirmationText: 'The client declares having read, understood, and accepted all terms and conditions of this contract.',
      pageOf: 'Page {current} of {total}',
    },
  },
  'es-ES': {
    common: {
      greeting: 'Hola, <strong>{name}</strong>!',
      anyQuestions: 'Si tienes alguna duda, contacta a tu consultora.',
      deadlineTitle: '📅 Entrega estimada',
      deadlineSub: 'Plazo calculado en días hábiles. Recibirás un aviso cuando tu resultado esté listo.',
      btnAccessFix: 'Ir al portal y corregir',
      dateLocale: 'es-ES',
    },
    contractSigned: {
      subject: 'Contrato de {plan}{brandSuffix}',
      title: 'Contrato Firmado',
      successTitle: '&#10003; ¡Contrato firmado con éxito!',
      successText: 'El PDF del contrato está adjunto a este correo para tu registro.',
      labelPlan: 'Plan',
      labelName: 'Nombre',
      labelEmail: 'Correo electrónico',
      labelSignedAt: 'Firmado el',
      labelIp: 'IP',
      followPortal: 'Sigue el avance de tu análisis en el portal:',
      btnAccessPortal: 'Acceder a mi portal',
    },
    analysisApproved: {
      subject: '¡Tu análisis fue aprobado!{brandSuffix}',
      title: '¡Análisis en curso!',
      successTitle: '&#10003; ¡Todo listo! Tu análisis fue aprobado.',
      successText: 'Tus fotos y formulario fueron revisados y están listos para tu análisis de color.',
      followStatus: 'Sigue el estado de tu análisis en el portal:',
      btnViewStatus: 'Ver el estado de mi análisis',
    },
    analysisRejected: {
      subject: 'Tu análisis necesita un ajuste{brandSuffix}',
      title: 'Ajuste Necesario',
      warnTitle: '&#9888;&#65039; Necesitamos un ajuste antes de continuar',
      warnText: 'No te preocupes — tus datos están guardados. Accede al portal y ajusta solo lo que se solicita abajo.',
      photosAdjustLabel: '&#128247; Ajuste en las fotos',
      formAdjustLabel: '&#128203; Ajuste en el formulario',
      goFix: 'Accede al portal para realizar los ajustes:',
      afterFixNote: 'Después del ajuste, el envío se hará automáticamente para una nueva revisión.',
    },
    partialResultReleased: {
      subject: 'Vista previa de tu resultado disponible{brandSuffix}',
      title: 'Vista Previa de tu Resultado',
      previewTitle: '¡Tu vista previa está disponible!',
      previewText: 'Accede al portal para consultar el resultado parcial de tu análisis.',
      stillWorkingTitle: '&#9203; Simulaciones aún en curso',
      stillWorkingSub: 'Tu consultora todavía está terminando los últimos detalles. Recibirás un nuevo aviso en cuanto el resultado completo esté listo.',
      btnViewPreview: 'Ver mi vista previa',
    },
    resultReleased: {
      subject: '¡Tu análisis {plan} está listo!{brandSuffix}',
      title: '¡Tu Análisis {plan} está Listo!',
      readyTitle: '¡Tu análisis {plan} está listo!',
      readyText: 'Sigue el enlace de abajo para ver tu resultado completo.',
      btnViewResult: 'Ver mi resultado',
      thanksNote: 'Muchas gracias por elegirme para formar parte de este descubrimiento,<br>fue un placer atenderte. &#10084;&#65039;',
    },
    photosApproved: {
      subject: '¡Tus fotos fueron aprobadas!{brandSuffix}',
      title: '¡Fotos Aprobadas!',
      successTitle: '&#10003; ¡Tus fotos fueron aprobadas!',
      successText: 'Todo listo por aquí. Tu análisis ya está en curso.',
      followPortal: 'Sigue el avance de tu análisis en el portal:',
      btnFollow: 'Seguir mi análisis',
    },
    photosRejected: {
      subject: 'Tus fotos necesitan un ajuste{brandSuffix}',
      title: 'Ajuste en las Fotos',
      warnTitle: '&#9888;&#65039; Necesitamos un ajuste en tus fotos',
      warnText: 'No te preocupes — tus fotos actuales están guardadas. Accede al portal y reemplaza solo lo que se solicita abajo.',
      reasonLabel: '&#128247; Motivo del ajuste',
      goSendNew: 'Accede al portal para enviar las nuevas fotos:',
      afterResendNote: 'Después del reenvío, tus fotos serán revisadas nuevamente.',
    },
    formRejected: {
      subject: 'Tu formulario necesita un ajuste{brandSuffix}',
      title: 'Ajuste en el Formulario',
      warnTitle: '&#9888;&#65039; Necesitamos un ajuste en tu formulario',
      warnText: 'No te preocupes — tus datos están guardados. Accede al portal y corrige solo lo que se solicita abajo.',
      reasonLabel: '&#128203; Motivo del ajuste',
      goCorrect: 'Accede al portal para realizar la corrección:',
      afterCorrectNote: 'Después de la corrección, el formulario se reenviará automáticamente para revisión.',
    },
    bothRejected: {
      subject: 'Ajustes necesarios en tu análisis{brandSuffix}',
      title: 'Ajustes Necesarios',
      warnTitle: '&#9888;&#65039; Necesitamos algunos ajustes antes de continuar',
      warnText: 'No te preocupes — tus datos están guardados. Accede al portal y corrige solo lo que se solicita abajo.',
      photosAdjustLabel: '&#128247; Ajuste en las fotos',
      formAdjustLabel: '&#128203; Ajuste en el formulario',
      goFix: 'Accede al portal para realizar los ajustes:',
      afterFixNote: 'Después de los ajustes, el envío se hará automáticamente para una nueva revisión.',
    },
    pdfContract: {
      defaultTitle: 'Contrato de Prestación de Servicios',
      contractorSection: 'CLIENTE',
      planLabel: 'Plan',
      signedBadge: '[FIRMADO]  Aceptado digitalmente por {name}',
      onDate: 'el {datetime}',
      atSeparator: 'a las',
      emailLabel: 'Correo electrónico',
      ipLabel: 'IP del firmante',
      handwrittenSignature: 'Firma manuscrita digital:',
      signatureFallback: 'Firma',
      confirmationText: 'La cliente declara haber leído, comprendido y aceptado todos los términos y condiciones de este contrato.',
      pageOf: 'Página {current} de {total}',
    },
  },

  'fr-FR': {
    common: {
      greeting: 'Bonjour <strong>{name}</strong> !',
      anyQuestions: 'Pour toute question, contactez votre conseillère.',
      deadlineTitle: '📅 Livraison estimée',
      deadlineSub: "Délai calculé en jours ouvrés. Vous recevrez un avis dès que votre résultat sera prêt.",
      btnAccessFix: 'Aller sur le portail et corriger',
      dateLocale: 'fr-FR',
    },
    contractSigned: {
      subject: 'Contrat {plan}{brandSuffix}',
      title: 'Contrat Signé',
      successTitle: '&#10003; Contrat signé avec succès !',
      successText: 'Le PDF du contrat est joint à cet e-mail pour vos archives.',
      labelPlan: 'Forfait',
      labelName: 'Nom',
      labelEmail: 'E-mail',
      labelSignedAt: 'Signé le',
      labelIp: 'IP',
      followPortal: "Suivez l'avancement de votre analyse sur le portail :",
      btnAccessPortal: 'Accéder à mon portail',
    },
    analysisApproved: {
      subject: 'Votre analyse a été approuvée !{brandSuffix}',
      title: 'Analyse en cours !',
      successTitle: '&#10003; Tout est bon ! Votre analyse a été approuvée.',
      successText: "Vos photos et votre formulaire ont été vérifiés et sont prêts pour votre analyse de colorimétrie.",
      followStatus: "Suivez le statut de votre analyse sur le portail :",
      btnViewStatus: 'Voir le statut de mon analyse',
    },
    analysisRejected: {
      subject: 'Votre analyse nécessite un ajustement{brandSuffix}',
      title: 'Ajustement Nécessaire',
      warnTitle: "&#9888;&#65039; Nous avons besoin d'un ajustement avant de continuer",
      warnText: "Pas d'inquiétude — vos données sont enregistrées. Accédez au portail et ajustez uniquement ce qui est demandé ci-dessous.",
      photosAdjustLabel: '&#128247; Ajustement sur les photos',
      formAdjustLabel: '&#128203; Ajustement sur le formulaire',
      goFix: 'Accédez au portail pour effectuer les ajustements :',
      afterFixNote: "Après l'ajustement, l'envoi sera automatiquement soumis pour une nouvelle vérification.",
    },
    partialResultReleased: {
      subject: "Aperçu de votre résultat disponible{brandSuffix}",
      title: 'Aperçu de votre Résultat',
      previewTitle: 'Votre aperçu est disponible !',
      previewText: 'Accédez au portail pour consulter le résultat partiel de votre analyse.',
      stillWorkingTitle: '&#9203; Simulations encore en cours',
      stillWorkingSub: "Votre conseillère finalise encore les derniers détails. Vous recevrez un nouvel avis dès que le résultat complet sera prêt.",
      btnViewPreview: 'Voir mon aperçu',
    },
    resultReleased: {
      subject: 'Votre analyse {plan} est prête !{brandSuffix}',
      title: 'Votre Analyse {plan} est Prête !',
      readyTitle: 'Votre analyse {plan} est prête !',
      readyText: 'Suivez le lien ci-dessous pour voir votre résultat complet.',
      btnViewResult: 'Voir mon résultat',
      thanksNote: "Merci beaucoup de m'avoir choisie pour faire partie de cette découverte,<br>ce fut un plaisir de vous accompagner. &#10084;&#65039;",
    },
    photosApproved: {
      subject: 'Vos photos ont été approuvées !{brandSuffix}',
      title: 'Photos Approuvées !',
      successTitle: '&#10003; Vos photos ont été approuvées !',
      successText: 'Tout est en ordre. Votre analyse est déjà en cours.',
      followPortal: "Suivez l'avancement de votre analyse sur le portail :",
      btnFollow: 'Suivre mon analyse',
    },
    photosRejected: {
      subject: 'Vos photos nécessitent un ajustement{brandSuffix}',
      title: 'Ajustement des Photos',
      warnTitle: "&#9888;&#65039; Nous avons besoin d'un ajustement sur vos photos",
      warnText: "Pas d'inquiétude — vos photos actuelles sont enregistrées. Accédez au portail et remplacez uniquement ce qui est demandé ci-dessous.",
      reasonLabel: "&#128247; Motif de l'ajustement",
      goSendNew: 'Accédez au portail pour envoyer les nouvelles photos :',
      afterResendNote: 'Après le renvoi, vos photos seront à nouveau vérifiées.',
    },
    formRejected: {
      subject: 'Votre formulaire nécessite un ajustement{brandSuffix}',
      title: 'Ajustement du Formulaire',
      warnTitle: "&#9888;&#65039; Nous avons besoin d'un ajustement sur votre formulaire",
      warnText: "Pas d'inquiétude — vos données sont enregistrées. Accédez au portail et corrigez uniquement ce qui est demandé ci-dessous.",
      reasonLabel: "&#128203; Motif de l'ajustement",
      goCorrect: 'Accédez au portail pour effectuer la correction :',
      afterCorrectNote: 'Après la correction, le formulaire sera automatiquement renvoyé pour vérification.',
    },
    bothRejected: {
      subject: 'Ajustements nécessaires sur votre analyse{brandSuffix}',
      title: 'Ajustements Nécessaires',
      warnTitle: "&#9888;&#65039; Nous avons besoin de quelques ajustements avant de continuer",
      warnText: "Pas d'inquiétude — vos données sont enregistrées. Accédez au portail et corrigez uniquement ce qui est demandé ci-dessous.",
      photosAdjustLabel: '&#128247; Ajustement sur les photos',
      formAdjustLabel: '&#128203; Ajustement sur le formulaire',
      goFix: 'Accédez au portail pour effectuer les ajustements :',
      afterFixNote: "Après les ajustements, l'envoi sera automatiquement soumis pour une nouvelle vérification.",
    },
    pdfContract: {
      defaultTitle: 'Contrat de Prestation de Services',
      contractorSection: 'CLIENTE',
      planLabel: 'Forfait',
      signedBadge: '[SIGNÉ]  Accepté numériquement par {name}',
      onDate: 'le {datetime}',
      atSeparator: 'à',
      emailLabel: 'E-mail',
      ipLabel: 'IP du signataire',
      handwrittenSignature: 'Signature manuscrite numérique :',
      signatureFallback: 'Signature',
      confirmationText: "La cliente déclare avoir lu, compris et accepté l'ensemble des termes et conditions de ce contrat.",
      pageOf: 'Page {current} sur {total}',
    },
  },

  'it-IT': {
    common: {
      greeting: 'Ciao, <strong>{name}</strong>!',
      anyQuestions: 'Per qualsiasi dubbio, contatta la tua consulente.',
      deadlineTitle: '📅 Consegna stimata',
      deadlineSub: 'Tempo calcolato in giorni lavorativi. Riceverai un avviso quando il tuo risultato sarà pronto.',
      btnAccessFix: 'Vai al portale e correggi',
      dateLocale: 'it-IT',
    },
    contractSigned: {
      subject: 'Contratto {plan}{brandSuffix}',
      title: 'Contratto Firmato',
      successTitle: '&#10003; Contratto firmato con successo!',
      successText: 'Il PDF del contratto è allegato a questa e-mail per i tuoi archivi.',
      labelPlan: 'Piano',
      labelName: 'Nome',
      labelEmail: 'E-mail',
      labelSignedAt: 'Firmato il',
      labelIp: 'IP',
      followPortal: "Segui l'andamento della tua analisi sul portale:",
      btnAccessPortal: 'Accedi al mio portale',
    },
    analysisApproved: {
      subject: 'La tua analisi è stata approvata!{brandSuffix}',
      title: 'Analisi in corso!',
      successTitle: '&#10003; Tutto pronto! La tua analisi è stata approvata.',
      successText: 'Le tue foto e il modulo sono stati esaminati e sono pronti per la tua analisi del colore.',
      followStatus: 'Segui lo stato della tua analisi sul portale:',
      btnViewStatus: 'Vedi lo stato della mia analisi',
    },
    analysisRejected: {
      subject: 'La tua analisi necessita di una modifica{brandSuffix}',
      title: 'Modifica Necessaria',
      warnTitle: '&#9888;&#65039; Abbiamo bisogno di una modifica prima di continuare',
      warnText: 'Non preoccuparti — i tuoi dati sono salvati. Accedi al portale e modifica solo quanto richiesto qui sotto.',
      photosAdjustLabel: '&#128247; Modifica alle foto',
      formAdjustLabel: '&#128203; Modifica al modulo',
      goFix: 'Accedi al portale per effettuare le modifiche:',
      afterFixNote: 'Dopo la modifica, l\'invio verrà effettuato automaticamente per una nuova revisione.',
    },
    partialResultReleased: {
      subject: 'Anteprima del tuo risultato disponibile{brandSuffix}',
      title: 'Anteprima del tuo Risultato',
      previewTitle: 'La tua anteprima è disponibile!',
      previewText: 'Accedi al portale per consultare il risultato parziale della tua analisi.',
      stillWorkingTitle: '&#9203; Simulazioni ancora in corso',
      stillWorkingSub: 'La tua consulente sta ancora completando gli ultimi dettagli. Riceverai un nuovo avviso non appena il risultato completo sarà pronto.',
      btnViewPreview: 'Vedi la mia anteprima',
    },
    resultReleased: {
      subject: 'La tua analisi {plan} è pronta!{brandSuffix}',
      title: 'La tua Analisi {plan} è Pronta!',
      readyTitle: 'La tua analisi {plan} è pronta!',
      readyText: 'Segui il link qui sotto per vedere il tuo risultato completo.',
      btnViewResult: 'Vedi il mio risultato',
      thanksNote: "Grazie mille per avermi scelta per far parte di questa scoperta,<br>è stato un piacere seguirti. &#10084;&#65039;",
    },
    photosApproved: {
      subject: 'Le tue foto sono state approvate!{brandSuffix}',
      title: 'Foto Approvate!',
      successTitle: '&#10003; Le tue foto sono state approvate!',
      successText: 'Tutto a posto. La tua analisi è già in corso.',
      followPortal: "Segui l'andamento della tua analisi sul portale:",
      btnFollow: 'Segui la mia analisi',
    },
    photosRejected: {
      subject: 'Le tue foto necessitano di una modifica{brandSuffix}',
      title: 'Modifica delle Foto',
      warnTitle: '&#9888;&#65039; Abbiamo bisogno di una modifica alle tue foto',
      warnText: 'Non preoccuparti — le tue foto attuali sono salvate. Accedi al portale e sostituisci solo quanto richiesto qui sotto.',
      reasonLabel: '&#128247; Motivo della modifica',
      goSendNew: 'Accedi al portale per inviare le nuove foto:',
      afterResendNote: "Dopo il reinvio, le tue foto verranno esaminate di nuovo.",
    },
    formRejected: {
      subject: 'Il tuo modulo necessita di una modifica{brandSuffix}',
      title: 'Modifica del Modulo',
      warnTitle: '&#9888;&#65039; Abbiamo bisogno di una modifica al tuo modulo',
      warnText: 'Non preoccuparti — i tuoi dati sono salvati. Accedi al portale e correggi solo quanto richiesto qui sotto.',
      reasonLabel: '&#128203; Motivo della modifica',
      goCorrect: 'Accedi al portale per effettuare la correzione:',
      afterCorrectNote: 'Dopo la correzione, il modulo verrà reinviato automaticamente per la revisione.',
    },
    bothRejected: {
      subject: 'Modifiche necessarie alla tua analisi{brandSuffix}',
      title: 'Modifiche Necessarie',
      warnTitle: '&#9888;&#65039; Abbiamo bisogno di alcune modifiche prima di continuare',
      warnText: 'Non preoccuparti — i tuoi dati sono salvati. Accedi al portale e correggi solo quanto richiesto qui sotto.',
      photosAdjustLabel: '&#128247; Modifica alle foto',
      formAdjustLabel: '&#128203; Modifica al modulo',
      goFix: 'Accedi al portale per effettuare le modifiche:',
      afterFixNote: 'Dopo le modifiche, l\'invio verrà effettuato automaticamente per una nuova revisione.',
    },
    pdfContract: {
      defaultTitle: 'Contratto di Prestazione di Servizi',
      contractorSection: 'CLIENTE',
      planLabel: 'Piano',
      signedBadge: '[FIRMATO]  Accettato digitalmente da {name}',
      onDate: 'il {datetime}',
      atSeparator: 'alle',
      emailLabel: 'E-mail',
      ipLabel: 'IP del firmatario',
      handwrittenSignature: 'Firma autografa digitale:',
      signatureFallback: 'Firma',
      confirmationText: 'La cliente dichiara di aver letto, compreso e accettato tutti i termini e le condizioni di questo contratto.',
      pageOf: 'Pagina {current} di {total}',
    },
  },

  'de-DE': {
    common: {
      greeting: 'Hallo, <strong>{name}</strong>!',
      anyQuestions: 'Bei Fragen wende dich an deine Beraterin.',
      deadlineTitle: '📅 Voraussichtliche Lieferung',
      deadlineSub: 'Frist berechnet in Werktagen. Du erhältst eine Benachrichtigung, sobald dein Ergebnis fertig ist.',
      btnAccessFix: 'Zum Portal gehen und korrigieren',
      dateLocale: 'de-DE',
    },
    contractSigned: {
      subject: 'Vertrag {plan}{brandSuffix}',
      title: 'Vertrag Unterschrieben',
      successTitle: '&#10003; Vertrag erfolgreich unterschrieben!',
      successText: 'Das Vertrags-PDF ist dieser E-Mail zu deinen Unterlagen beigefügt.',
      labelPlan: 'Paket',
      labelName: 'Name',
      labelEmail: 'E-Mail',
      labelSignedAt: 'Unterschrieben am',
      labelIp: 'IP',
      followPortal: 'Verfolge den Fortschritt deiner Analyse im Portal:',
      btnAccessPortal: 'Zu meinem Portal',
    },
    analysisApproved: {
      subject: 'Deine Analyse wurde genehmigt!{brandSuffix}',
      title: 'Analyse in Bearbeitung!',
      successTitle: '&#10003; Alles bereit! Deine Analyse wurde genehmigt.',
      successText: 'Deine Fotos und dein Formular wurden geprüft und sind bereit für deine Farbanalyse.',
      followStatus: 'Verfolge den Status deiner Analyse im Portal:',
      btnViewStatus: 'Status meiner Analyse ansehen',
    },
    analysisRejected: {
      subject: 'Deine Analyse benötigt eine Anpassung{brandSuffix}',
      title: 'Anpassung Erforderlich',
      warnTitle: '&#9888;&#65039; Wir benötigen eine Anpassung, bevor wir fortfahren können',
      warnText: 'Keine Sorge — deine Daten sind gespeichert. Gehe zum Portal und passe nur das an, was unten angefordert wird.',
      photosAdjustLabel: '&#128247; Anpassung an den Fotos',
      formAdjustLabel: '&#128203; Anpassung am Formular',
      goFix: 'Gehe zum Portal, um die Anpassungen vorzunehmen:',
      afterFixNote: 'Nach der Anpassung wird sie automatisch zur erneuten Prüfung gesendet.',
    },
    partialResultReleased: {
      subject: 'Vorschau deines Ergebnisses verfügbar{brandSuffix}',
      title: 'Vorschau deines Ergebnisses',
      previewTitle: 'Deine Vorschau ist verfügbar!',
      previewText: 'Gehe zum Portal, um das Teilergebnis deiner Analyse einzusehen.',
      stillWorkingTitle: '&#9203; Simulationen noch in Bearbeitung',
      stillWorkingSub: 'Deine Beraterin arbeitet noch an den letzten Details. Du erhältst eine neue Benachrichtigung, sobald das vollständige Ergebnis bereit ist.',
      btnViewPreview: 'Meine Vorschau ansehen',
    },
    resultReleased: {
      subject: 'Deine {plan}-Analyse ist fertig!{brandSuffix}',
      title: 'Deine {plan}-Analyse ist Fertig!',
      readyTitle: 'Deine {plan}-Analyse ist fertig!',
      readyText: 'Folge dem Link unten, um dein vollständiges Ergebnis zu sehen.',
      btnViewResult: 'Mein Ergebnis ansehen',
      thanksNote: 'Vielen Dank, dass du mich für diese Entdeckungsreise ausgewählt hast,<br>es war mir eine Freude, dich zu begleiten. &#10084;&#65039;',
    },
    photosApproved: {
      subject: 'Deine Fotos wurden genehmigt!{brandSuffix}',
      title: 'Fotos Genehmigt!',
      successTitle: '&#10003; Deine Fotos wurden genehmigt!',
      successText: 'Alles in Ordnung. Deine Analyse läuft bereits.',
      followPortal: 'Verfolge den Fortschritt deiner Analyse im Portal:',
      btnFollow: 'Meine Analyse verfolgen',
    },
    photosRejected: {
      subject: 'Deine Fotos benötigen eine Anpassung{brandSuffix}',
      title: 'Anpassung der Fotos',
      warnTitle: '&#9888;&#65039; Wir benötigen eine Anpassung deiner Fotos',
      warnText: 'Keine Sorge — deine aktuellen Fotos sind gespeichert. Gehe zum Portal und ersetze nur das, was unten angefordert wird.',
      reasonLabel: '&#128247; Grund für die Anpassung',
      goSendNew: 'Gehe zum Portal, um die neuen Fotos zu senden:',
      afterResendNote: 'Nach dem erneuten Senden werden deine Fotos erneut geprüft.',
    },
    formRejected: {
      subject: 'Dein Formular benötigt eine Anpassung{brandSuffix}',
      title: 'Anpassung des Formulars',
      warnTitle: '&#9888;&#65039; Wir benötigen eine Anpassung an deinem Formular',
      warnText: 'Keine Sorge — deine Daten sind gespeichert. Gehe zum Portal und korrigiere nur das, was unten angefordert wird.',
      reasonLabel: '&#128203; Grund für die Anpassung',
      goCorrect: 'Gehe zum Portal, um die Korrektur vorzunehmen:',
      afterCorrectNote: 'Nach der Korrektur wird das Formular automatisch erneut zur Prüfung gesendet.',
    },
    bothRejected: {
      subject: 'Anpassungen an deiner Analyse erforderlich{brandSuffix}',
      title: 'Anpassungen Erforderlich',
      warnTitle: '&#9888;&#65039; Wir benötigen einige Anpassungen, bevor wir fortfahren können',
      warnText: 'Keine Sorge — deine Daten sind gespeichert. Gehe zum Portal und korrigiere nur das, was unten angefordert wird.',
      photosAdjustLabel: '&#128247; Anpassung an den Fotos',
      formAdjustLabel: '&#128203; Anpassung am Formular',
      goFix: 'Gehe zum Portal, um die Anpassungen vorzunehmen:',
      afterFixNote: 'Nach den Anpassungen wird die Übermittlung automatisch zur erneuten Prüfung gesendet.',
    },
    pdfContract: {
      defaultTitle: 'Dienstleistungsvertrag',
      contractorSection: 'KUNDIN',
      planLabel: 'Paket',
      signedBadge: '[UNTERSCHRIEBEN]  Digital akzeptiert von {name}',
      onDate: 'am {datetime}',
      atSeparator: 'um',
      emailLabel: 'E-Mail',
      ipLabel: 'IP der unterzeichnenden Person',
      handwrittenSignature: 'Digitale handschriftliche Unterschrift:',
      signatureFallback: 'Unterschrift',
      confirmationText: 'Die Kundin erklärt, alle Bedingungen dieses Vertrags gelesen, verstanden und akzeptiert zu haben.',
      pageOf: 'Seite {current} von {total}',
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


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Corrige portalUrl com localhost vindo do frontend em dev ─────────────────
function sanitizePortalUrl(url: string): string {
  if (!url) return url
  const siteUrl = Deno.env.get('SITE_URL') || ''
  if (!siteUrl) return url
  return url.replace(/^https?:\/\/localhost(:\d+)?/, siteUrl.replace(/\/$/, ''))
}

// ── Monta header "From" em formato RFC 5322 ──────────────────────────────────
//
// Recebe o nome de exibição (do settings do admin) e o endereço de e-mail global
// (que pode vir como "email puro" ou como "Display <email>"). Retorna o header
// completo com o nome de exibição + e-mail do remetente, ex:
//
//   buildFromHeader('Salão da Fulana', 'contato@iacolor.online')
//     → 'Salão da Fulana <contato@iacolor.online>'
//
//   buildFromHeader('', 'noreply@x.com')
//     → 'noreply@x.com'  (fallback sem display name)
//
// Caracteres especiais (vírgula, ponto-e-vírgula) forçam aspas duplas
// no display name pra não quebrar o header.
function buildFromHeader(displayName: string, fromHeaderOrEmail: string): string {
  const src = (fromHeaderOrEmail || '').trim()
  if (!src) return 'onboarding@resend.dev'

  // Extrai só o e-mail caso `src` venha como "Display <email>"
  const match = src.match(/<([^>]+)>/)
  const email = (match ? match[1] : src).trim()

  const name = (displayName || '').replace(/[<>"]/g, '').trim()
  if (!name) return src   // sem display name → usa o header global cru

  // Quote se tiver vírgula/ponto-e-vírgula/dois-pontos (RFC 5322)
  if (/[,;:]/.test(name)) return `"${name}" <${email}>`
  return `${name} <${email}>`
}

// ── Helper de quebra de texto ─────────────────────────────────────────────────
function wrapText(text: string, font: any, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = []
  const paragraphs = text.split('\n')
  for (const paragraph of paragraphs) {
    if (paragraph.trim() === '') { lines.push(''); continue }
    const words = paragraph.split(' ')
    let currentLine = ''
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word
      const width = font.widthOfTextAtSize(testLine, fontSize)
      if (width > maxWidth && currentLine) { lines.push(currentLine); currentLine = word }
      else { currentLine = testLine }
    }
    if (currentLine) lines.push(currentLine)
  }
  return lines
}

// ── Geração do PDF do contrato ────────────────────────────────────────────────
//
// Correções aplicadas:
//  • Aceita `clientIp` e `signatureDataUrl` como parâmetros
//  • Exibe IP do signatário no bloco de assinatura
//  • Hora com segundos (HH:mm:ss)
//  • Embute a imagem PNG da assinatura manuscrita via pdfDoc.embedPng()
//  • Bloco de assinatura calculado previamente — nunca quebra de página

async function generateContractPDF(
  contractTitle: string,
  sections: Array<{ title: string; content: string; order: number }>,
  clientName: string,
  clientEmail: string,
  planName: string,
  signedAt: string,
  clientIp?: string,
  signatureDataUrl?: string,
  brandName?: string,
  lang: EmailLanguage = 'pt-BR',
): Promise<Uint8Array> {
  const pdfDoc      = await PDFDocument.create()
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const PAGE_W      = 595.28
  const PAGE_H      = 841.89
  const MARGIN      = 60
  const CONTENT_W   = PAGE_W - MARGIN * 2
  const LINE_HEIGHT = 16
  const SECTION_GAP = 24

  let page = pdfDoc.addPage([PAGE_W, PAGE_H])
  let y    = PAGE_H - MARGIN

  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN) {
      page = pdfDoc.addPage([PAGE_W, PAGE_H])
      y    = PAGE_H - MARGIN
    }
  }

  // ── Faixa de cor no topo ──────────────────────────────────────────────────
  page.drawRectangle({
    x: 0, y: PAGE_H - 8, width: PAGE_W, height: 8,
    color: rgb(0.937, 0.267, 0.459),
  })
  y -= 16

  // ── Título do contrato ────────────────────────────────────────────────────
  const titleLines = wrapText(contractTitle, fontBold, 16, CONTENT_W)
  for (const line of titleLines) {
    ensureSpace(22)
    const tw = fontBold.widthOfTextAtSize(line, 16)
    page.drawText(line, {
      x: MARGIN + (CONTENT_W - tw) / 2, y,
      size: 16, font: fontBold, color: rgb(0.067, 0.067, 0.067),
    })
    y -= 22
  }
  y -= 12

  // ── Bloco do contratante ──────────────────────────────────────────────────
  ensureSpace(80)
  page.drawRectangle({
    x: MARGIN, y: y - 60, width: CONTENT_W, height: 68,
    color: rgb(0.96, 0.96, 0.98),
    borderColor: rgb(0.88, 0.88, 0.92), borderWidth: 0.5,
  })
  page.drawText(t(lang, 'pdfContract.contractorSection'), {
    x: MARGIN + 14, y: y - 16, size: 9, font: fontBold, color: rgb(0.4, 0.4, 0.5),
  })
  page.drawText(clientName, {
    x: MARGIN + 14, y: y - 32, size: 11, font: fontBold, color: rgb(0.1, 0.1, 0.1),
  })
  page.drawText(`${clientEmail}  -  ${t(lang, 'pdfContract.planLabel')}: ${planName}`, {
    x: MARGIN + 14, y: y - 48, size: 10, font: fontRegular, color: rgb(0.4, 0.4, 0.45),
  })
  y -= 84

  // ── Cláusulas ─────────────────────────────────────────────────────────────
  const sorted = [...sections].sort((a, b) => a.order - b.order)
  for (const section of sorted) {
    if (section.title) {
      const stLines = wrapText(section.title, fontBold, 11, CONTENT_W)
      for (const line of stLines) {
        ensureSpace(LINE_HEIGHT + 4)
        page.drawText(line, { x: MARGIN, y, size: 11, font: fontBold, color: rgb(0.1, 0.1, 0.1) })
        y -= LINE_HEIGHT
      }
      y -= 4
    }
    const contentLines = wrapText(section.content, fontRegular, 10, CONTENT_W)
    for (const line of contentLines) {
      ensureSpace(LINE_HEIGHT)
      if (line === '') { y -= 8; continue }
      page.drawText(line, { x: MARGIN, y, size: 10, font: fontRegular, color: rgb(0.25, 0.25, 0.28) })
      y -= LINE_HEIGHT
    }
    y -= SECTION_GAP
  }

  // ── Bloco de assinatura digital ───────────────────────────────────────────
  //
  // Calculamos o espaço total ANTES de começar a desenhar.
  // Se não couber na página atual, forçamos nova página,
  // garantindo que assinatura + dados legais fiquem sempre juntos.
  //
  const sigImgH   = signatureDataUrl ? 60 : 24
  const extraRows = (clientIp ? 1 : 0)
  const sigBlockH = 20             // linha divisória + margem
                  + LINE_HEIGHT    // "[ASSINADO]  Aceito por..."
                  + LINE_HEIGHT    // "em DD/MM/YYYY às HH:mm:ss"
                  + LINE_HEIGHT    // "E-mail: ..."
                  + extraRows * LINE_HEIGHT
                  + 16             // espaço antes da assinatura
                  + sigImgH        // caixa/linha da assinatura
                  + 10             // margem
                  + 36             // caixa de declaração legal
                  + 10             // margem final

  if (y - sigBlockH < MARGIN) {
    page = pdfDoc.addPage([PAGE_W, PAGE_H])
    y    = PAGE_H - MARGIN
  }

  // Linha divisória
  y -= 8
  page.drawLine({
    start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y },
    thickness: 0.5, color: rgb(0.85, 0.85, 0.88),
  })
  y -= 20

  // Data e hora com segundos (timezone Brasil — servidor roda em UTC)
  const signDate    = new Date(signedAt)
  const dateStr     = signDate.toLocaleDateString(lang, {
    day: '2-digit', month: '2-digit', year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  })
  const timeStr     = signDate.toLocaleTimeString(lang, {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
  const datetimeStr = `${dateStr} ${t(lang, 'pdfContract.atSeparator')} ${timeStr}`

  page.drawText(t(lang, 'pdfContract.signedBadge', { name: clientName }), {
    x: MARGIN, y, size: 10, font: fontBold, color: rgb(0.13, 0.55, 0.33),
  })
  y -= LINE_HEIGHT

  page.drawText(t(lang, 'pdfContract.onDate', { datetime: datetimeStr }), {
    x: MARGIN + 14, y, size: 9, font: fontRegular, color: rgb(0.42, 0.42, 0.45),
  })
  y -= LINE_HEIGHT

  page.drawText(`${t(lang, 'pdfContract.emailLabel')}: ${clientEmail}`, {
    x: MARGIN + 14, y, size: 9, font: fontRegular, color: rgb(0.42, 0.42, 0.45),
  })
  y -= LINE_HEIGHT

  if (clientIp) {
    page.drawText(`${t(lang, 'pdfContract.ipLabel')}: ${clientIp}`, {
      x: MARGIN + 14, y, size: 9, font: fontRegular, color: rgb(0.42, 0.42, 0.45),
    })
    y -= LINE_HEIGHT
  }

  y -= 8

  // ── Assinatura manuscrita (PNG base64) ────────────────────────────────────
  if (signatureDataUrl) {
    try {
      const base64Data = signatureDataUrl.replace(/^data:image\/png;base64,/, '')
      const pngBytes   = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))
      const pngImage   = await pdfDoc.embedPng(pngBytes)

      const sigW = 160
      const sigH = 48

      page.drawText(t(lang, 'pdfContract.handwrittenSignature'), {
        x: MARGIN, y, size: 8, font: fontBold, color: rgb(0.3, 0.3, 0.3),
      })
      y -= 6

      // Caixa de fundo
      page.drawRectangle({
        x: MARGIN, y: y - sigH, width: sigW, height: sigH,
        color: rgb(1, 1, 1),
        borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.5,
      })

      // Linha de base
      page.drawLine({
        start: { x: MARGIN + 4,        y: y - sigH + 10 },
        end:   { x: MARGIN + sigW - 4, y: y - sigH + 10 },
        thickness: 0.5, color: rgb(0.82, 0.82, 0.82),
      })

      // Imagem da assinatura
      page.drawImage(pngImage, {
        x:      MARGIN + 4,
        y:      y - sigH + 12,
        width:  sigW - 8,
        height: sigH - 16,
      })

      y -= sigH + 10
    } catch (imgErr) {
      console.warn('Nao foi possivel inserir a imagem da assinatura:', imgErr)
      // Fallback: linha clássica
      page.drawLine({
        start: { x: MARGIN, y: y - 12 }, end: { x: MARGIN + 120, y: y - 12 },
        thickness: 0.5, color: rgb(0, 0, 0),
      })
      y -= 24
    }
  } else {
    page.drawLine({
      start: { x: MARGIN, y: y - 12 }, end: { x: MARGIN + 120, y: y - 12 },
      thickness: 0.5, color: rgb(0, 0, 0),
    })
    page.drawText(t(lang, 'pdfContract.signatureFallback'), {
      x: MARGIN, y: y - 22, size: 8, font: fontRegular, color: rgb(0.6, 0.6, 0.6),
    })
    y -= 30
  }

  // ── Declaração legal ──────────────────────────────────────────────────────
  y -= 4
  const declarationText = t(lang, 'pdfContract.confirmationText')
  const declarationLines = wrapText(declarationText, fontRegular, 8, CONTENT_W - 20)
  const declBoxH = declarationLines.length * 12 + 16

  page.drawRectangle({
    x: MARGIN, y: y - declBoxH + 8, width: CONTENT_W, height: declBoxH,
    color: rgb(0.95, 0.95, 0.95),
    borderColor: rgb(0.75, 0.75, 0.75), borderWidth: 0.5,
  })

  let dy = y - 4
  for (const line of declarationLines) {
    page.drawText(line, {
      x: MARGIN + 8, y: dy, size: 8, font: fontRegular, color: rgb(0.35, 0.35, 0.35),
    })
    dy -= 12
  }

  // ── Rodapé em todas as páginas ────────────────────────────────────────────
  const pages = pdfDoc.getPages()
  const footerBrand = (brandName || '').trim()
  pages.forEach((p, i) => {
    const pageLabel = t(lang, 'pdfContract.pageOf', { current: String(i + 1), total: String(pages.length) })
    const text = footerBrand
      ? `${footerBrand}  -  ${pageLabel}`
      : pageLabel
    p.drawText(
      text,
      { x: MARGIN, y: 30, size: 8, font: fontRegular, color: rgb(0.6, 0.6, 0.65) }
    )
  })

  return await pdfDoc.save()
}

// ── Template base de e-mail (responsivo para mobile) ─────────────────────────

function buildEmail(title: string, greeting: string, body: string, brandName?: string, lang: EmailLanguage = 'pt-BR'): string {
  const brand = (brandName || '').trim()
  const headerBrandHtml = brand
    ? `<p class="header-brand" style="margin: 0 0 4px; font-size: 11px; color: #ffe4e6; letter-spacing: 2px; text-transform: uppercase;">${brand}</p>`
    : ''
  const footerBrandHtml = brand
    ? `<p class="footer-brand" style="margin: 28px 0 0; color: #9ca3af; font-size: 11px; text-align: center;">${brand}</p>`
    : ''
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 0; background: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; -webkit-text-size-adjust: 100%; }
    .wrapper { background: #f3f4f6; padding: 24px 12px; }
    .container { max-width: 600px; width: 100%; margin: 0 auto; }
    .header { background: #ec4899; background: linear-gradient(135deg, #fb7185, #ec4899); border-radius: 16px 16px 0 0; padding: 28px 24px; text-align: center; }
    .header-brand { margin: 0 0 4px; font-size: 11px; color: #ffe4e6; letter-spacing: 2px; text-transform: uppercase; }
    .header-title { margin: 0; font-size: 20px; color: #ffffff; font-weight: 700; line-height: 1.3; }
    .body { background: #ffffff; padding: 28px 24px; border-radius: 0 0 16px 16px; }
    .greeting { margin: 0 0 20px; color: #374151; font-size: 15px; line-height: 1.6; }
    .footer-brand { margin: 28px 0 0; color: #9ca3af; font-size: 11px; text-align: center; }
    .info-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin: 16px 0; }
    .info-row { display: flex; padding: 5px 0; font-size: 14px; }
    .info-label { color: #6b7280; min-width: 100px; flex-shrink: 0; }
    .info-value { color: #374151; font-weight: 600; }
    .btn-wrap { text-align: center; margin: 24px 0; }
    .btn { display: inline-block; background: #ec4899; background: linear-gradient(135deg, #fb7185, #ec4899); color: #ffffff !important; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 15px; }
    .alert-green { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    .alert-green-title { margin: 0 0 4px; font-size: 14px; color: #166534; font-weight: 600; }
    .alert-green-text { margin: 0; font-size: 13px; color: #15803d; }
    .alert-yellow { background: #fefce8; border: 1px solid #fde68a; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    .alert-yellow-title { margin: 0 0 4px; font-size: 13px; color: #92400e; font-weight: 600; }
    .alert-yellow-value { margin: 0; font-size: 15px; color: #78350f; font-weight: 700; text-transform: capitalize; }
    .alert-yellow-sub { margin: 6px 0 0; font-size: 12px; color: #a16207; }
    .alert-pink { background: linear-gradient(135deg, #fdf2f8, #fce7f3); border: 1px solid #fbcfe8; border-radius: 12px; padding: 20px; margin-bottom: 16px; text-align: center; }
    .alert-pink-emoji { margin: 0 0 8px; font-size: 28px; }
    .alert-pink-title { margin: 0 0 4px; font-size: 16px; color: #9d174d; font-weight: 700; }
    .alert-pink-text { margin: 0; font-size: 13px; color: #be185d; }
    .alert-amber { background: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    .alert-amber-title { margin: 0 0 4px; font-size: 14px; color: #92400e; font-weight: 600; }
    .alert-amber-text { margin: 0; font-size: 13px; color: #b45309; }
    .rejection-box { border-radius: 12px; padding: 16px; margin-bottom: 12px; }
    .rejection-purple { background: #faf5ff; border: 1px solid #e9d5ff; }
    .rejection-blue { background: #eff6ff; border: 1px solid #bfdbfe; }
    .rejection-type { margin: 0 0 6px; font-size: 13px; font-weight: 700; }
    .rejection-type-purple { color: #7c3aed; }
    .rejection-type-blue { color: #2563eb; }
    .rejection-reason { margin: 0; font-size: 14px; color: #374151; line-height: 1.6; }
    .small-center { color: #9ca3af; font-size: 12px; text-align: center; line-height: 1.6; }
    @media only screen and (max-width: 480px) {
      .wrapper { padding: 12px 8px !important; }
      .header { padding: 20px 16px !important; border-radius: 12px 12px 0 0 !important; }
      .header-title { font-size: 17px !important; }
      .body { padding: 20px 16px !important; border-radius: 0 0 12px 12px !important; }
      .btn { padding: 13px 24px !important; font-size: 14px !important; display: block !important; }
      .info-box { padding: 12px !important; }
      .info-row { flex-direction: column !important; padding: 6px 0 !important; }
      .info-label { min-width: auto !important; margin-bottom: 2px; font-size: 11px !important; }
      .info-value { font-size: 13px !important; }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr><td align="center">
        <table class="container" cellpadding="0" cellspacing="0" role="presentation">
          <tr><td class="header" bgcolor="#ec4899" style="background-color: #ec4899; background: linear-gradient(135deg, #fb7185, #ec4899); border-radius: 16px 16px 0 0; padding: 28px 24px; text-align: center;">
            ${headerBrandHtml}
            <h1 class="header-title" style="margin: 0; font-size: 20px; color: #ffffff; font-weight: 700; line-height: 1.3;">${title}</h1>
          </td></tr>
          <tr><td class="body">
            <p class="greeting">${greeting}</p>
            ${body}
            ${footerBrandHtml}
          </td></tr>
        </table>
      </td></tr>
    </table>
  </div>
</body>
</html>`
}

function linkButton(url: string, label: string): string {
  return `<div class="btn-wrap"><a href="${url}" class="btn">${label}</a></div>`
}

function infoTable(rows: Array<[string, string]>): string {
  const trs = rows.map(([label, value]) => `
    <tr>
      <td style="padding:5px 8px 5px 0;font-size:13px;color:#6b7280;white-space:nowrap;vertical-align:top;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${label}</td>
      <td style="padding:5px 0;font-size:13px;color:#374151;font-weight:600;vertical-align:top;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${value}</td>
    </tr>`).join('')
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:12px 16px;margin:16px 0;border-collapse:separate;border-spacing:0;">
    <tr><td style="padding:12px 16px;">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">${trs}</table>
    </td></tr>
  </table>`
}

// ── Edge Function principal ───────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const rawBody  = await req.text()
    const userAgent = req.headers.get('user-agent') || 'unknown'
    const origin    = req.headers.get('origin')     || 'no-origin'
    const referer   = req.headers.get('referer')    || 'no-referer'
    console.log(`[DEBUG request] method=${req.method} | bytes=${rawBody.length} | ua="${userAgent}" | origin="${origin}" | referer="${referer}"`)

    let payload: any = {}
    try {
      payload = rawBody ? JSON.parse(rawBody) : {}
    } catch (parseErr) {
      console.warn(`[DEBUG request] body nao e JSON valido: ${rawBody.slice(0, 200)}`)
      return jsonResponse({ error: 'Body invalido' }, 400)
    }

    const emailType = payload.type
    if (!emailType) {
      console.warn(`[DEBUG request] payload.type ausente. payload keys=${Object.keys(payload).join(',') || '(vazio)'}`)
      return jsonResponse({ skipped: true, reason: 'type ausente no payload' })
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    console.log(`[DEBUG payload] type=${emailType} | adminId=${payload.adminId ?? 'NULL'} | clientToken=${payload.clientToken ?? 'NULL'}`)

    let clientFromDb: {
      full_name?: string
      email?: string
      admin_id?: string | null
      plan_name?: string
      language?: string | null
    } | null = null

    if (payload.clientToken) {
      const { data: row } = await supabaseClient
        .from('clients')
        .select('full_name, email, admin_id, plan:plans(name), language')
        .eq('token', payload.clientToken)
        .maybeSingle()

      if (row) {
        clientFromDb = {
          full_name: (row as any).full_name ?? '',
          email:     (row as any).email     ?? '',
          admin_id:  (row as any).admin_id  ?? null,
          plan_name: (row as any).plan?.name ?? '',
          language:  (row as any).language  ?? null,
        }
        console.log(`[${emailType}] cliente hidratado via clientToken: email=${clientFromDb.email} admin_id=${clientFromDb.admin_id ?? 'NULL'}`)
      } else {
        console.warn(`[${emailType}] clientToken nao encontrado em clients`)
      }
    }

    let adminId: string | null = payload.adminId || clientFromDb?.admin_id || null

    if (!adminId) {
      adminId = Deno.env.get('DEFAULT_ADMIN_ID') || null
      if (adminId) {
        console.log(`[${emailType}] adminId resolvido via DEFAULT_ADMIN_ID env var`)
      }
    }

    if (!adminId) {
      console.warn(`[${emailType}] adminId nao resolvido. Pulando envio.`)
      return jsonResponse({ skipped: true, reason: 'adminId nao resolvido' })
    }

    const clientName  = (payload.clientName  || clientFromDb?.full_name || '').trim()
    const clientEmail = (payload.clientEmail || clientFromDb?.email     || '').trim()
    const planName    = (payload.planName    || clientFromDb?.plan_name || '').trim()

    const { data: settingsRow } = await supabaseClient
      .from('admin_content')
      .select('content')
      .eq('type', 'settings')
      .eq('admin_id', adminId)
      .maybeSingle()

    const cfg = settingsRow?.content as any
    const ADMIN_EMAIL = cfg?.adminEmail

    // Idioma da CLIENTE para os e-mails que vao pra ela (contrato, aprovacao,
    // ajuste, resultado...). Prioridade: idioma explicito no payload (caso o
    // front va mandar no futuro) -> idioma ja salvo em clients.language ->
    // idioma padrao do admin (settings.defaultLanguage) -> pt-BR.
    // Os e-mails que vao SO pro admin continuam sempre em portugues.
    const clientLanguage = resolveEmailLanguage(
      payload.clientLanguage || clientFromDb?.language || cfg?.defaultLanguage
    )

    // ─── Config global compartilhada (super_admin) ─────────────────────────
    //
    // O super_admin configura UMA VEZ a chave Resend + domínio remetente
    // (em admin_content type='global_email_settings'). Todos os admins
    // (salões) usam essa config — eles só preenchem o `adminEmail` deles.
    //
    // A config própria do admin (cfg.resendApiKey / cfg.fromEmail) ainda
    // tem precedência se existir — escape hatch pra admin legacy que já
    // tinha configurado conta própria antes dessa mudança.
    const { data: superAdminRow } = await supabaseClient
      .from('admin_users')
      .select('id')
      .eq('role', 'super_admin')
      .limit(1)
      .maybeSingle()

    let globalResendKey: string | null = null
    let globalFromEmail: string | null = null

    if (superAdminRow?.id) {
      const { data: globalRow } = await supabaseClient
        .from('admin_content')
        .select('content')
        .eq('admin_id', superAdminRow.id)
        .eq('type', 'global_email_settings')
        .maybeSingle()

      const globalCfg = globalRow?.content as any
      globalResendKey = globalCfg?.resendApiKey || null
      globalFromEmail = globalCfg?.fromEmail || null
    }

    // Nome de exibição do remetente — cada usuário (admin OU super_admin) define o
    // próprio no settings. Fallback pra admins.nome (nome dado pelo super_admin ao
    // criar o admin) se o usuário ainda não preencheu o campo personalizado.
    //
    // A cliente vê: "<emailDisplayName> <contato@mariliasantoscolor.com.br>"
    // Ex: "Marília Color <contato@...>" ou "Salão da Fulana <contato@...>".
    let adminDisplayName = (cfg?.emailDisplayName || '').trim()

    if (!adminDisplayName) {
      const { data: thisAdminRow } = await supabaseClient
        .from('admin_users')
        .select('nome')
        .eq('id', adminId)
        .maybeSingle()
      adminDisplayName = (thisAdminRow?.nome || '').trim()
    }

    // Sempre usa a config GLOBAL do super_admin — sem escape hatch.
    // (A UI já esconde os campos resendApiKey/fromEmail no settings do admin,
    // mas valores legacy do banco poderiam interferir se respeitássemos `cfg`.)
    const RESEND_API_KEY = globalResendKey
    const FROM_EMAIL_BASE = globalFromEmail || 'onboarding@resend.dev'
    const FROM_EMAIL = buildFromHeader(adminDisplayName, FROM_EMAIL_BASE)

    // Nome de marca usado nos subjects, headers/footers de e-mail e PDF.
    // Genérico — vem do que o admin definir como `emailDisplayName`. Se vazio,
    // os e-mails e PDFs não exibem marca (fallback minimalista).
    const BRAND = adminDisplayName
    const BRAND_SUFFIX = BRAND ? ` - ${BRAND}` : ''
    const BRAND_PREFIX = BRAND ? `[${BRAND}] ` : ''

    // Wrapper que injeta o BRAND automaticamente em todas as chamadas de buildEmail.
    // Evita repetir BRAND como último argumento em cada uma das ~12 chamadas.
    const renderEmail = (title: string, greeting: string, body: string, lang: EmailLanguage = 'pt-BR') =>
      buildEmail(title, greeting, body, BRAND, lang)

    // Atalho para os e-mails de CLIENTE: ja injeta o idioma dela automaticamente.
    const renderClientEmail = (title: string, greeting: string, body: string) =>
      renderEmail(title, greeting, body, clientLanguage)

    if (!RESEND_API_KEY || !ADMIN_EMAIL) {
      console.warn(`[${emailType}] E-mail nao configurado para admin ${adminId}. Pulando envio. (resendKey=${!!RESEND_API_KEY}, adminEmail=${!!ADMIN_EMAIL})`)
      return jsonResponse({ skipped: true })
    }

    const send = async (to: string, subject: string, html: string, attachments: any[] = []) => {
      const body: any = { from: FROM_EMAIL, to, subject, html }
      if (attachments.length > 0) body.attachments = attachments
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Resend error ${res.status}: ${text}`)
      }
    }

    const sendToClient = async (subject: string, html: string, attachments: any[] = []) => {
      if (!clientEmail) {
        console.warn(`[${emailType}] clientEmail vazio — envio pro cliente pulado. token=${payload.clientToken ?? 'NULL'}`)
        return
      }
      await send(clientEmail, subject, html, attachments)
    }

    // ============================================================
    // TIPO 1: CONTRATO ASSINADO
    // Envia PDF do contrato (com assinatura manuscrita + IP) para
    // cliente e admin via Resend.
    // ============================================================
    if (emailType === 'contract_signed') {
      const { signedAt, contractTitle, sections } = payload

      // Campos enviados pelo ClientSignup.tsx (corrigido)
      const contractIp           = (payload.ip             || '').trim()
      const contractSignatureUrl = (payload.signatureDataUrl || '').trim()

      const portalUrl = sanitizePortalUrl(payload.portalUrl || '')
      const dateOpts: Intl.DateTimeFormatOptions = {
        day: '2-digit', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZone: 'America/Sao_Paulo',
      }
      // Admin sempre ve em pt-BR; a cliente ve no idioma que ela escolheu.
      const formattedDateAdmin  = new Date(signedAt).toLocaleString('pt-BR', dateOpts)
      const formattedDateClient = new Date(signedAt).toLocaleString(clientLanguage, dateOpts)

      const title = contractTitle ?? t(clientLanguage, 'pdfContract.defaultTitle')
      let pdfBase64 = ''

      if (sections?.length) {
        const pdfBytes = await generateContractPDF(
          title,
          sections,
          clientName,
          clientEmail,
          planName,
          signedAt,
          contractIp           || undefined,
          contractSignatureUrl || undefined,
          BRAND,
          clientLanguage,
        )
        let binary = ''
        for (let i = 0; i < pdfBytes.length; i++) binary += String.fromCharCode(pdfBytes[i])
        pdfBase64 = btoa(binary)
      }

      const attachments = pdfBase64
        ? [{ filename: `Contrato - ${planName}.pdf`, content: pdfBase64 }]
        : []

      const subject = t(clientLanguage, 'contractSigned.subject', { plan: planName, brandSuffix: BRAND_SUFFIX })

      const clientHtml = renderClientEmail(
        t(clientLanguage, 'contractSigned.title'),
        t(clientLanguage, 'common.greeting', { name: clientName }),
        `<div class="alert-green">
          <p class="alert-green-title">${t(clientLanguage, 'contractSigned.successTitle')}</p>
          <p class="alert-green-text">${t(clientLanguage, 'contractSigned.successText')}</p>
        </div>
        ${infoTable([
          [t(clientLanguage, 'contractSigned.labelPlan'),     planName],
          [t(clientLanguage, 'contractSigned.labelName'),     clientName],
          [t(clientLanguage, 'contractSigned.labelEmail'),    clientEmail],
          [t(clientLanguage, 'contractSigned.labelSignedAt'), formattedDateClient],
          ...(contractIp ? [[t(clientLanguage, 'contractSigned.labelIp'), contractIp] as [string, string]] : []),
        ])}
        ${portalUrl
          ? `<p style="color:#374151;font-size:14px;line-height:1.6;margin:16px 0 0">${t(clientLanguage, 'contractSigned.followPortal')}</p>${linkButton(portalUrl, t(clientLanguage, 'contractSigned.btnAccessPortal'))}`
          : ''
        }`
      )

      const adminHtml = renderEmail(
        'Nova Assinatura de Contrato',
        '&#128221; Nova cliente cadastrada!',
        `${infoTable([
          ['Cliente',     clientName],
          ['E-mail',      clientEmail],
          ['Plano',       planName],
          ['Assinado em', formattedDateAdmin],
          ...(contractIp ? [['IP', contractIp] as [string, string]] : []),
        ])}`
      )

      const results = await Promise.allSettled([
        sendToClient(subject, clientHtml, attachments),
        send(ADMIN_EMAIL, `${BRAND_PREFIX}Nova assinatura: ${clientName} - ${planName}`, adminHtml, attachments),
      ])
      logResults(results, 'contract_signed')
      return jsonResponse({ success: true, type: 'contract_signed' })
    }

    // ============================================================
    // TIPO 2: FOTOS FINALIZADAS (cliente submeteu fotos)
    // ============================================================
    if (emailType === 'photos_finalized') {
      const adminHtml = renderEmail(
        '📷 Fotos para Revisar',
        `<strong>${clientName}</strong> finalizou o envio de fotos e aguarda sua aprovacao.`,
        `${infoTable([['Cliente', clientName], ['E-mail', clientEmail], ['Plano', planName]])}`
      )

      const results = await Promise.allSettled([
        send(ADMIN_EMAIL, `${BRAND_PREFIX}📷 Fotos para revisar: ${clientName}`, adminHtml),
      ])
      logResults(results, 'photos_finalized')
      return jsonResponse({ success: true, type: 'photos_finalized' })
    }

    // ============================================================
    // TIPO 3: ANALISE APROVADA (admin aprovou fotos + form)
    // ============================================================
    if (emailType === 'analysis_approved') {
      const { deadlineDate } = payload
      const portalUrl = sanitizePortalUrl(payload.portalUrl || '')

      const formattedDeadline = deadlineDate
        ? new Date(deadlineDate + 'T12:00:00').toLocaleDateString(clientLanguage, {
            weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
            timeZone: 'America/Sao_Paulo',
          })
        : ''

      const subject = t(clientLanguage, 'analysisApproved.subject', { brandSuffix: BRAND_SUFFIX })

      const clientHtml = renderClientEmail(
        t(clientLanguage, 'analysisApproved.title'),
        t(clientLanguage, 'common.greeting', { name: clientName }),
        `<div class="alert-green">
          <p class="alert-green-title">${t(clientLanguage, 'analysisApproved.successTitle')}</p>
          <p class="alert-green-text">${t(clientLanguage, 'analysisApproved.successText')}</p>
        </div>
        ${formattedDeadline ? `
        <div class="alert-yellow">
          <p class="alert-yellow-title">${t(clientLanguage, 'common.deadlineTitle')}</p>
          <p class="alert-yellow-value">${formattedDeadline}</p>
          <p class="alert-yellow-sub">${t(clientLanguage, 'common.deadlineSub')}</p>
        </div>` : ''}
        <p style="color:#374151;font-size:14px;line-height:1.6;margin:0 0 4px">${t(clientLanguage, 'analysisApproved.followStatus')}</p>
        ${linkButton(portalUrl, t(clientLanguage, 'analysisApproved.btnViewStatus'))}
        <p class="small-center">${t(clientLanguage, 'common.anyQuestions')}</p>`
      )

      const results = await Promise.allSettled([
        sendToClient(subject, clientHtml),
      ])
      logResults(results, 'analysis_approved')
      return jsonResponse({ success: true, type: 'analysis_approved' })
    }

    // ============================================================
    // TIPO 4: AJUSTE SOLICITADO (admin rejeitou fotos e/ou form)
    // ============================================================
    if (emailType === 'analysis_rejected') {
      const { rejectPhotos, photosReason, rejectForm, formReason } = payload
      const portalUrl = sanitizePortalUrl(payload.portalUrl || '')

      const subject = t(clientLanguage, 'analysisRejected.subject', { brandSuffix: BRAND_SUFFIX })

      const rejectionBlocks = [
        rejectPhotos && photosReason ? `
        <div class="rejection-box rejection-purple">
          <p class="rejection-type rejection-type-purple">${t(clientLanguage, 'analysisRejected.photosAdjustLabel')}</p>
          <p class="rejection-reason">${photosReason}</p>
        </div>` : '',
        rejectForm && formReason ? `
        <div class="rejection-box rejection-blue">
          <p class="rejection-type rejection-type-blue">${t(clientLanguage, 'analysisRejected.formAdjustLabel')}</p>
          <p class="rejection-reason">${formReason}</p>
        </div>` : '',
      ].filter(Boolean).join('')

      const clientHtml = renderClientEmail(
        t(clientLanguage, 'analysisRejected.title'),
        t(clientLanguage, 'common.greeting', { name: clientName }),
        `<div class="alert-amber">
          <p class="alert-amber-title">${t(clientLanguage, 'analysisRejected.warnTitle')}</p>
          <p class="alert-amber-text">${t(clientLanguage, 'analysisRejected.warnText')}</p>
        </div>
        ${rejectionBlocks}
        <p style="color:#374151;font-size:14px;line-height:1.6;margin:16px 0 4px">${t(clientLanguage, 'analysisRejected.goFix')}</p>
        ${linkButton(portalUrl, t(clientLanguage, 'common.btnAccessFix'))}
        <p class="small-center">${t(clientLanguage, 'analysisRejected.afterFixNote')}</p>`
      )

      const results = await Promise.allSettled([
        sendToClient(subject, clientHtml),
      ])
      logResults(results, 'analysis_rejected')
      return jsonResponse({ success: true, type: 'analysis_rejected' })
    }

    // ============================================================
    // TIPO 5b: RESULTADO PARCIAL LIBERADO (prévia durante simulações)
    // ============================================================
    if (emailType === 'partial_result_released') {
      const portalUrl = sanitizePortalUrl(payload.portalUrl || '')
      const subject = t(clientLanguage, 'partialResultReleased.subject', { brandSuffix: BRAND_SUFFIX })

      const clientHtml = renderClientEmail(
        t(clientLanguage, 'partialResultReleased.title'),
        t(clientLanguage, 'common.greeting', { name: clientName }),
        `<div class="alert-pink">
          <p class="alert-pink-emoji">✨</p>
          <p class="alert-pink-title">${t(clientLanguage, 'partialResultReleased.previewTitle')}</p>
          <p class="alert-pink-text">${t(clientLanguage, 'partialResultReleased.previewText')}</p>
        </div>
        <div class="alert-yellow">
          <p class="alert-yellow-title">${t(clientLanguage, 'partialResultReleased.stillWorkingTitle')}</p>
          <p class="alert-yellow-sub">${t(clientLanguage, 'partialResultReleased.stillWorkingSub')}</p>
        </div>
        ${linkButton(portalUrl, t(clientLanguage, 'partialResultReleased.btnViewPreview'))}
        <p class="small-center">${t(clientLanguage, 'common.anyQuestions')}</p>`
      )

      const results = await Promise.allSettled([
        sendToClient(subject, clientHtml),
      ])
      logResults(results, 'partial_result_released')
      return jsonResponse({ success: true, type: 'partial_result_released' })
    }

    // ============================================================
    // TIPO 5: RESULTADO FINAL LIBERADO
    // ============================================================
    if (emailType === 'result_released') {
      const portalUrl = sanitizePortalUrl(payload.portalUrl || '')
      const subject = t(clientLanguage, 'resultReleased.subject', { plan: planName, brandSuffix: BRAND_SUFFIX })

      const clientHtml = renderClientEmail(
        t(clientLanguage, 'resultReleased.title', { plan: planName }),
        t(clientLanguage, 'common.greeting', { name: clientName }),
        `<div class="alert-pink">
          <p class="alert-pink-emoji">&#127881;</p>
          <p class="alert-pink-title">${t(clientLanguage, 'resultReleased.readyTitle', { plan: planName })}</p>
          <p class="alert-pink-text">${t(clientLanguage, 'resultReleased.readyText')}</p>
        </div>
        ${linkButton(portalUrl, t(clientLanguage, 'resultReleased.btnViewResult'))}
        <p class="small-center">
          ${t(clientLanguage, 'resultReleased.thanksNote')}
        </p>`
      )

      const results = await Promise.allSettled([
        sendToClient(subject, clientHtml),
      ])
      logResults(results, 'result_released')
      return jsonResponse({ success: true, type: 'result_released' })
    }

    // ============================================================
    // TIPO 6: FOTOS APROVADAS
    // ============================================================
    if (emailType === 'photos_approved') {
      const { deadlineDate } = payload
      const portalUrl = sanitizePortalUrl(payload.portalUrl || '')

      const formattedDeadline = deadlineDate
        ? new Date(deadlineDate + 'T12:00:00').toLocaleDateString(clientLanguage, {
            weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
            timeZone: 'America/Sao_Paulo',
          })
        : ''

      const subject = t(clientLanguage, 'photosApproved.subject', { brandSuffix: BRAND_SUFFIX })

      const clientHtml = renderClientEmail(
        t(clientLanguage, 'photosApproved.title'),
        t(clientLanguage, 'common.greeting', { name: clientName }),
        `<div class="alert-green">
          <p class="alert-green-title">${t(clientLanguage, 'photosApproved.successTitle')}</p>
          <p class="alert-green-text">${t(clientLanguage, 'photosApproved.successText')}</p>
        </div>
        ${formattedDeadline ? `
        <div class="alert-yellow">
          <p class="alert-yellow-title">${t(clientLanguage, 'common.deadlineTitle')}</p>
          <p class="alert-yellow-value">${formattedDeadline}</p>
          <p class="alert-yellow-sub">${t(clientLanguage, 'common.deadlineSub')}</p>
        </div>` : ''}
        <p style="color:#374151;font-size:14px;line-height:1.6;margin:0 0 4px">${t(clientLanguage, 'photosApproved.followPortal')}</p>
        ${linkButton(portalUrl, t(clientLanguage, 'photosApproved.btnFollow'))}
        <p class="small-center">${t(clientLanguage, 'common.anyQuestions')}</p>`
      )

      const results = await Promise.allSettled([
        sendToClient(subject, clientHtml),
      ])
      logResults(results, 'photos_approved')
      return jsonResponse({ success: true, type: 'photos_approved' })
    }

    // ============================================================
    // TIPO 7: FOTOS REJEITADAS
    // ============================================================
    if (emailType === 'photos_rejected') {
      const { reason } = payload
      const portalUrl  = sanitizePortalUrl(payload.portalUrl || '')
      const subject = t(clientLanguage, 'photosRejected.subject', { brandSuffix: BRAND_SUFFIX })

      const clientHtml = renderClientEmail(
        t(clientLanguage, 'photosRejected.title'),
        t(clientLanguage, 'common.greeting', { name: clientName }),
        `<div class="alert-amber">
          <p class="alert-amber-title">${t(clientLanguage, 'photosRejected.warnTitle')}</p>
          <p class="alert-amber-text">${t(clientLanguage, 'photosRejected.warnText')}</p>
        </div>
        <div class="rejection-box rejection-purple">
          <p class="rejection-type rejection-type-purple">${t(clientLanguage, 'photosRejected.reasonLabel')}</p>
          <p class="rejection-reason">${reason}</p>
        </div>
        <p style="color:#374151;font-size:14px;line-height:1.6;margin:16px 0 4px">${t(clientLanguage, 'photosRejected.goSendNew')}</p>
        ${linkButton(portalUrl, t(clientLanguage, 'common.btnAccessFix'))}
        <p class="small-center">${t(clientLanguage, 'photosRejected.afterResendNote')}</p>`
      )

      const results = await Promise.allSettled([
        sendToClient(subject, clientHtml),
      ])
      logResults(results, 'photos_rejected')
      return jsonResponse({ success: true, type: 'photos_rejected' })
    }

    // ============================================================
    // TIPO 8: FORMULARIO REJEITADO
    // ============================================================
    if (emailType === 'form_rejected') {
      const { reason } = payload
      const portalUrl  = sanitizePortalUrl(payload.portalUrl || '')
      const subject = t(clientLanguage, 'formRejected.subject', { brandSuffix: BRAND_SUFFIX })

      const clientHtml = renderClientEmail(
        t(clientLanguage, 'formRejected.title'),
        t(clientLanguage, 'common.greeting', { name: clientName }),
        `<div class="alert-amber">
          <p class="alert-amber-title">${t(clientLanguage, 'formRejected.warnTitle')}</p>
          <p class="alert-amber-text">${t(clientLanguage, 'formRejected.warnText')}</p>
        </div>
        <div class="rejection-box rejection-blue">
          <p class="rejection-type rejection-type-blue">${t(clientLanguage, 'formRejected.reasonLabel')}</p>
          <p class="rejection-reason">${reason}</p>
        </div>
        <p style="color:#374151;font-size:14px;line-height:1.6;margin:16px 0 4px">${t(clientLanguage, 'formRejected.goCorrect')}</p>
        ${linkButton(portalUrl, t(clientLanguage, 'common.btnAccessFix'))}
        <p class="small-center">${t(clientLanguage, 'formRejected.afterCorrectNote')}</p>`
      )

      const results = await Promise.allSettled([
        sendToClient(subject, clientHtml),
      ])
      logResults(results, 'form_rejected')
      return jsonResponse({ success: true, type: 'form_rejected' })
    }

    // ============================================================
    // TIPO 9: AMBOS REJEITADOS (fotos + form)
    // ============================================================
    if (emailType === 'both_rejected') {
      const { formReason, photosReason } = payload
      const portalUrl = sanitizePortalUrl(payload.portalUrl || '')
      const subject = t(clientLanguage, 'bothRejected.subject', { brandSuffix: BRAND_SUFFIX })

      const clientHtml = renderClientEmail(
        t(clientLanguage, 'bothRejected.title'),
        t(clientLanguage, 'common.greeting', { name: clientName }),
        `<div class="alert-amber">
          <p class="alert-amber-title">${t(clientLanguage, 'bothRejected.warnTitle')}</p>
          <p class="alert-amber-text">${t(clientLanguage, 'bothRejected.warnText')}</p>
        </div>
        ${photosReason ? `
        <div class="rejection-box rejection-purple">
          <p class="rejection-type rejection-type-purple">${t(clientLanguage, 'bothRejected.photosAdjustLabel')}</p>
          <p class="rejection-reason">${photosReason}</p>
        </div>` : ''}
        ${formReason ? `
        <div class="rejection-box rejection-blue">
          <p class="rejection-type rejection-type-blue">${t(clientLanguage, 'bothRejected.formAdjustLabel')}</p>
          <p class="rejection-reason">${formReason}</p>
        </div>` : ''}
        <p style="color:#374151;font-size:14px;line-height:1.6;margin:16px 0 4px">${t(clientLanguage, 'bothRejected.goFix')}</p>
        ${linkButton(portalUrl, t(clientLanguage, 'common.btnAccessFix'))}
        <p class="small-center">${t(clientLanguage, 'bothRejected.afterFixNote')}</p>`
      )

      const results = await Promise.allSettled([
        sendToClient(subject, clientHtml),
      ])
      logResults(results, 'both_rejected')
      return jsonResponse({ success: true, type: 'both_rejected' })
    }

    // ============================================================
    // ALIAS: photos_submitted → mesmo comportamento de photos_finalized
    // ============================================================
    if (emailType === 'photos_submitted') {
      const adminPanelUrl = sanitizePortalUrl(payload.adminPanelUrl || '')
      const adminHtml = renderEmail(
        '📷 Fotos para Revisar',
        `<strong>${clientName}</strong> finalizou o envio de fotos e aguarda sua aprovacao.`,
        `${infoTable([['Cliente', clientName], ['E-mail', clientEmail], ['Plano', planName]])}
        ${adminPanelUrl ? '<p style="color:#374151;font-size:14px;line-height:1.6;margin:16px 0 4px">Acesse o painel para revisar e aprovar:</p>' + linkButton(adminPanelUrl, 'Revisar fotos no painel') : ''}`
      )

      const results = await Promise.allSettled([
        send(ADMIN_EMAIL, `${BRAND_PREFIX}📷 Fotos para revisar: ${clientName}`, adminHtml),
      ])
      logResults(results, 'photos_submitted')
      return jsonResponse({ success: true, type: 'photos_submitted' })
    }

    // ============================================================
    // TIPO 12: FOTO PARA SIMULAÇÃO (IA) ENVIADA
    // ============================================================
    if (emailType === 'ai_photo_submitted') {
      const adminPanelUrl = sanitizePortalUrl(payload.adminPanelUrl || '')
      const adminHtml = renderEmail(
        '✨ Foto para simulação enviada',
        `<strong>${clientName}</strong> enviou a foto para a simulação. A consultora deve validar antes de avançar para "Simulações".`,
        `${infoTable([['Cliente', clientName], ['E-mail', clientEmail], ['Plano', planName]])}
        ${adminPanelUrl ? '<p style="color:#374151;font-size:14px;line-height:1.6;margin:16px 0 4px">Acesse o painel para validar a foto:</p>' + linkButton(adminPanelUrl, 'Validar foto no painel') : ''}`
      )

      const results = await Promise.allSettled([
        send(ADMIN_EMAIL, `${BRAND_PREFIX}✨ Foto IA para validar: ${clientName}`, adminHtml),
      ])
      logResults(results, 'ai_photo_submitted')
      return jsonResponse({ success: true, type: 'ai_photo_submitted' })
    }

    return jsonResponse({ error: 'Tipo de e-mail desconhecido: ' + emailType }, 400)

  } catch (error: any) {
    const msg = error?.message || String(error)
    console.error('send-contract-email error:', msg)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

function logResults(results: PromiseSettledResult<void>[], type: string) {
  results.forEach((r, i) => {
    const target = i === 0 ? 'cliente' : 'admin'
    if (r.status === 'rejected') {
      console.warn(`[${type}] Falha ao enviar para ${target}:`, (r as PromiseRejectedResult).reason?.message)
    }
  })
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}