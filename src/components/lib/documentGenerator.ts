import jsPDF from 'jspdf';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

interface ContractData {
  title: string;
  sections: Array<{
    title: string;
    content: string;
  }>;
  accepted: boolean;
  timestamp: string;
}

interface FormData {
  [key: string]: any;
}

export class DocumentGenerator {
  /**
   * Gera um PDF do contrato
   */
  static generateContractPDF(contractData: ContractData, clientName: string): Blob {
    const pdf = new jsPDF();
    let yPosition = 20;
    const pageHeight = pdf.internal.pageSize.height;
    const margin = 20;
    const maxWidth = pdf.internal.pageSize.width - 2 * margin;

    // Título
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    const titleLines = pdf.splitTextToSize(contractData.title, maxWidth);
    titleLines.forEach((line: string) => {
      if (yPosition > pageHeight - margin) {
        pdf.addPage();
        yPosition = margin;
      }
      pdf.text(line, margin, yPosition);
      yPosition += 8;
    });

    yPosition += 10;

    // Seções
    pdf.setFontSize(12);
    contractData.sections.forEach((section) => {
      // Título da seção
      if (yPosition > pageHeight - margin) {
        pdf.addPage();
        yPosition = margin;
      }
      
      pdf.setFont('helvetica', 'bold');
      pdf.text(section.title, margin, yPosition);
      yPosition += 7;

      // Conteúdo da seção
      pdf.setFont('helvetica', 'normal');
      const contentLines = pdf.splitTextToSize(section.content, maxWidth);
      contentLines.forEach((line: string) => {
        if (yPosition > pageHeight - margin) {
          pdf.addPage();
          yPosition = margin;
        }
        pdf.text(line, margin, yPosition);
        yPosition += 6;
      });

      yPosition += 10;
    });

    // Assinatura
    if (yPosition > pageHeight - 60) {
      pdf.addPage();
      yPosition = margin;
    }

    yPosition += 20;
    pdf.setFont('helvetica', 'bold');
    pdf.text('ACEITE DO CONTRATO', margin, yPosition);
    yPosition += 10;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.text(`Cliente: ${clientName}`, margin, yPosition);
    yPosition += 7;
    pdf.text(`Data de aceite: ${new Date(contractData.timestamp).toLocaleString('pt-BR')}`, margin, yPosition);
    yPosition += 7;
    pdf.text('Assinatura digital: ✓ Aceito eletronicamente', margin, yPosition);

    return pdf.output('blob');
  }

  /**
   * Gera um PDF do formulário
   */
  static generateFormPDF(formData: FormData, clientName: string, formConfig: any): Blob {
    const pdf = new jsPDF();
    let yPosition = 20;
    const pageHeight = pdf.internal.pageSize.height;
    const margin = 20;
    const maxWidth = pdf.internal.pageSize.width - 2 * margin;

    // Título
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.text('FORMULÁRIO DE ANÁLISE DE COLORAÇÃO PESSOAL', margin, yPosition);
    yPosition += 15;

    // Nome do cliente
    pdf.setFontSize(12);
    pdf.text(`Cliente: ${clientName}`, margin, yPosition);
    yPosition += 7;
    pdf.text(`Data: ${new Date().toLocaleDateString('pt-BR')}`, margin, yPosition);
    yPosition += 15;

    // Campos do formulário
    pdf.setFontSize(11);
    
    if (formConfig && formConfig.sections) {
      formConfig.sections.forEach((section: any) => {
        // Título da seção
        if (yPosition > pageHeight - margin) {
          pdf.addPage();
          yPosition = margin;
        }

        pdf.setFont('helvetica', 'bold');
        pdf.text(section.title, margin, yPosition);
        yPosition += 8;

        // Campos da seção
        section.fields.forEach((field: any) => {
          if (yPosition > pageHeight - margin - 20) {
            pdf.addPage();
            yPosition = margin;
          }

          pdf.setFont('helvetica', 'bold');
          pdf.text(`${field.label}:`, margin, yPosition);
          yPosition += 6;

          pdf.setFont('helvetica', 'normal');
          const value = formData[field.id] || 'Não informado';
          const valueLines = pdf.splitTextToSize(String(value), maxWidth - 10);
          
          valueLines.forEach((line: string) => {
            if (yPosition > pageHeight - margin) {
              pdf.addPage();
              yPosition = margin;
            }
            pdf.text(line, margin + 5, yPosition);
            yPosition += 5;
          });

          yPosition += 5;
        });

        yPosition += 5;
      });
    } else {
      // Fallback: mostrar todos os dados do formulário
      Object.entries(formData).forEach(([key, value]) => {
        if (yPosition > pageHeight - margin - 20) {
          pdf.addPage();
          yPosition = margin;
        }

        pdf.setFont('helvetica', 'bold');
        pdf.text(`${key}:`, margin, yPosition);
        yPosition += 6;

        pdf.setFont('helvetica', 'normal');
        const valueLines = pdf.splitTextToSize(String(value), maxWidth - 10);
        valueLines.forEach((line: string) => {
          if (yPosition > pageHeight - margin) {
            pdf.addPage();
            yPosition = margin;
          }
          pdf.text(line, margin + 5, yPosition);
          yPosition += 5;
        });

        yPosition += 8;
      });
    }

    return pdf.output('blob');
  }

  /**
   * Cria um arquivo ZIP com todos os documentos organizados
   */
  static async createClientPackage(
    clientName: string,
    contractData: ContractData,
    formData: FormData,
    formConfig: any,
    photos: File[],
    formAttachments: File[] = []
  ): Promise<Blob> {
    const zip = new JSZip();

    // Criar pasta principal com o nome do cliente
    const clientFolder = zip.folder(this.sanitizeFileName(clientName)) || zip;

    // 1. Adicionar PDF do contrato
    const contractPDF = this.generateContractPDF(contractData, clientName);
    clientFolder.file('Contrato.pdf', contractPDF);

    // 2. Adicionar PDF do formulário
    const formPDF = this.generateFormPDF(formData, clientName, formConfig);
    clientFolder.file('Formulario.pdf', formPDF);

    // 3. Criar pasta de fotos e adicionar todas as fotos
    if (photos.length > 0) {
      const photosFolder = clientFolder.folder('Fotos') || clientFolder;
      
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        const extension = photo.name.split('.').pop() || 'jpg';
        const photoName = `Foto_${i + 1}.${extension}`;
        photosFolder.file(photoName, photo);
      }
    }

    // 4. Criar pasta de anexos do formulário (se houver)
    if (formAttachments.length > 0) {
      const attachmentsFolder = clientFolder.folder('Anexos_Formulario') || clientFolder;
      
      for (let i = 0; i < formAttachments.length; i++) {
        const attachment = formAttachments[i];
        attachmentsFolder.file(attachment.name, attachment);
      }
    }

    // 5. Criar arquivo de informações (txt)
    const infoText = this.generateInfoText(clientName, contractData, formData, photos, formAttachments);
    clientFolder.file('Informacoes.txt', infoText);

    // Gerar o ZIP
    return await zip.generateAsync({ type: 'blob' });
  }

  /**
   * Salva o pacote ZIP no computador do usuário
   */
  static async downloadClientPackage(
    clientName: string,
    contractData: ContractData,
    formData: FormData,
    formConfig: any,
    photos: File[],
    formAttachments: File[] = []
  ): Promise<void> {
    try {
      const zipBlob = await this.createClientPackage(
        clientName,
        contractData,
        formData,
        formConfig,
        photos,
        formAttachments
      );

      const fileName = `${this.sanitizeFileName(clientName)}_${new Date().getTime()}.zip`;
      saveAs(zipBlob, fileName);
    } catch (error) {
      console.error('Erro ao criar pacote de documentos:', error);
      throw error;
    }
  }

  /**
   * Gera arquivo de texto com informações resumidas
   */
  private static generateInfoText(
    clientName: string,
    contractData: ContractData,
    formData: FormData,
    photos: File[],
    attachments: File[]
  ): string {
    const lines: string[] = [];
    
    lines.push('='.repeat(60));
    lines.push('INFORMAÇÕES DO CLIENTE - ANÁLISE DE COLORAÇÃO PESSOAL');
    lines.push('='.repeat(60));
    lines.push('');
    lines.push(`Cliente: ${clientName}`);
    lines.push(`Data de criação: ${new Date().toLocaleString('pt-BR')}`);
    lines.push('');
    lines.push('-'.repeat(60));
    lines.push('CONTRATO');
    lines.push('-'.repeat(60));
    lines.push(`Status: ${contractData.accepted ? 'Aceito' : 'Pendente'}`);
    lines.push(`Data de aceite: ${new Date(contractData.timestamp).toLocaleString('pt-BR')}`);
    lines.push('');
    lines.push('-'.repeat(60));
    lines.push('FORMULÁRIO');
    lines.push('-'.repeat(60));
    Object.entries(formData).forEach(([key, value]) => {
      lines.push(`${key}: ${value}`);
    });
    lines.push('');
    lines.push('-'.repeat(60));
    lines.push('FOTOS');
    lines.push('-'.repeat(60));
    lines.push(`Total de fotos: ${photos.length}`);
    photos.forEach((photo, index) => {
      lines.push(`  ${index + 1}. ${photo.name} (${(photo.size / 1024 / 1024).toFixed(2)} MB)`);
    });
    lines.push('');
    
    if (attachments.length > 0) {
      lines.push('-'.repeat(60));
      lines.push('ANEXOS DO FORMULÁRIO');
      lines.push('-'.repeat(60));
      lines.push(`Total de anexos: ${attachments.length}`);
      attachments.forEach((attachment, index) => {
        lines.push(`  ${index + 1}. ${attachment.name} (${(attachment.size / 1024 / 1024).toFixed(2)} MB)`);
      });
      lines.push('');
    }
    
    lines.push('='.repeat(60));
    lines.push('Documento gerado automaticamente pelo sistema');
    lines.push('='.repeat(60));
    
    return lines.join('\n');
  }

  /**
   * Remove caracteres especiais do nome do arquivo
   */
  private static sanitizeFileName(fileName: string): string {
    return fileName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove acentos
      .replace(/[^a-zA-Z0-9_-]/g, '_')  // Substitui caracteres especiais por _
      .replace(/_+/g, '_')               // Remove _ duplicados
      .replace(/^_|_$/g, '');            // Remove _ do início e fim
  }

  /**
   * Salva também no Google Drive (se configurado)
   */
  static async uploadToGoogleDrive(
    zipBlob: Blob,
    fileName: string,
    folderId: string
  ): Promise<string> {
    // Esta função requer implementação da API do Google Drive
    // Por enquanto, vou deixar como placeholder
    console.log('Upload para Google Drive não implementado ainda');
    console.log('Arquivo:', fileName);
    console.log('Pasta ID:', folderId);
    
    // TODO: Implementar upload real para Google Drive
    // return uploadedFileId;
    return 'mock-file-id';
  }
}