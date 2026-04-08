import { supabase } from './supabase'

export interface ContractContent {
  title: string
  sections: Array<{
    id: string
    title: string
    content: string
    order: number
  }>
}

export interface FormField {
  id: string
  type: 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'image'
  label: string
  placeholder?: string
  options?: string[]
  required: boolean
  order: number
  maxImages?: number
  imageInstructions?: string
}

export interface FormContent {
  title: string
  description: string
  fields: FormField[]
}

class AdminContentService {
  async getContract(): Promise<ContractContent> {
    const { data, error } = await supabase
      .from('admin_content')
      .select('content')
      .eq('type', 'contract')
      .single()

    if (error || !data) {
      return this.getDefaultContract()
    }

    return data.content as ContractContent
  }

  async saveContract(content: ContractContent): Promise<void> {
    const { error } = await supabase
      .from('admin_content')
      .upsert({
        type: 'contract',
        content: content,
        updated_at: new Date().toISOString()
      })

    if (error) throw error
  }

  private getDefaultContract(): ContractContent {
    return {
      title: 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE ANÁLISE DE COLORAÇÃO PESSOAL',
      sections: [
        {
          id: '1',
          title: '1. OBJETO',
          content: 'Este contrato tem por objeto a prestação de serviços de análise de coloração pessoal, incluindo avaliação de características físicas e recomendações de paleta de cores.',
          order: 1
        },
        {
          id: '2',
          title: '2. RESPONSABILIDADES DO CLIENTE',
          content: '- Fornecer informações verdadeiras no formulário\n- Enviar fotos conforme instruções específicas\n- Seguir as orientações para melhor resultado da análise',
          order: 2
        },
        {
          id: '3',
          title: '3. RESPONSABILIDADES DA PRESTADORA',
          content: '- Realizar análise profissional baseada nas informações e fotos fornecidas\n- Entregar relatório completo com paleta de cores personalizada\n- Manter confidencialidade das informações do cliente',
          order: 3
        },
        {
          id: '4',
          title: '4. PRAZO',
          content: 'O prazo para entrega da análise é de até 5 dias úteis após o recebimento de todas as informações necessárias.',
          order: 4
        },
        {
          id: '5',
          title: '5. POLÍTICA DE PRIVACIDADE',
          content: 'Todas as informações e imagens fornecidas serão utilizadas exclusivamente para a análise contratada e mantidas em sigilo.',
          order: 5
        }
      ]
    }
  }

  async getForm(): Promise<FormContent> {
    const { data, error } = await supabase
      .from('admin_content')
      .select('content')
      .eq('type', 'form')
      .single()

    if (error || !data) {
      return this.getDefaultForm()
    }

    return data.content as FormContent
  }

  async saveForm(content: FormContent): Promise<void> {
    const { error } = await supabase
      .from('admin_content')
      .upsert({
        type: 'form',
        content: content,
        updated_at: new Date().toISOString()
      })

    if (error) throw error
  }

  private getDefaultForm(): FormContent {
    return {
      title: 'Formulário de Análise de Coloração Pessoal',
      description: 'Preencha suas informações para personalizar sua análise',
      fields: [
        {
          id: '1',
          type: 'text',
          label: 'Nome Completo',
          placeholder: 'Digite seu nome completo',
          required: true,
          order: 1
        },
        {
          id: '2',
          type: 'text',
          label: 'Idade',
          placeholder: 'Digite sua idade',
          required: true,
          order: 2
        },
        {
          id: '3',
          type: 'text',
          label: 'Profissão',
          placeholder: 'Digite sua profissão',
          required: false,
          order: 3
        },
        {
          id: '4',
          type: 'textarea',
          label: 'Qual seu objetivo com a análise de coloração?',
          placeholder: 'Descreva o que espera alcançar com a análise...',
          required: true,
          order: 4
        },
        {
          id: '5',
          type: 'radio',
          label: 'Você já fez análise de coloração antes?',
          options: ['Sim', 'Não'],
          required: true,
          order: 5
        },
        {
          id: '6',
          type: 'select',
          label: 'Como descreveria seu estilo?',
          options: ['Clássico', 'Moderno', 'Casual', 'Elegante', 'Alternativo'],
          required: false,
          order: 6
        },
        {
          id: '7',
          type: 'textarea',
          label: 'Quais são suas cores favoritas para usar?',
          placeholder: 'Liste as cores que mais gosta de usar...',
          required: false,
          order: 7
        },
        {
          id: '8',
          type: 'textarea',
          label: 'Há cores que você evita usar? Por quê?',
          placeholder: 'Descreva cores que não gosta e o motivo...',
          required: false,
          order: 8
        }
      ]
    }
  }

  generateContractText(contract: ContractContent): string {
    let text = contract.title + '\n\n'
    
    const sortedSections = [...contract.sections].sort((a, b) => a.order - b.order)
    
    for (const section of sortedSections) {
      text += section.title + '\n'
      text += section.content + '\n\n'
    }
    
    text += 'Ao aceitar este contrato, o cliente declara estar ciente e de acordo com todos os termos apresentados.'
    
    return text
  }
}

export const adminContentService = new AdminContentService()