import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

/**
 * Extract plain text from TipTap editor JSON
 */
function extractTextFromEditorJSON(editorJSON) {
  let text = '';
  
  function traverse(node) {
    if (node.type === 'text') {
      text += node.text || '';
    } else if (node.type === 'hardBreak') {
      text += '\n';
    } else if (node.type === 'paragraph') {
      if (node.content) {
        node.content.forEach(traverse);
      }
      text += '\n\n';
    } else if (node.type === 'heading') {
      const level = node.attrs?.level || 1;
      const prefix = '#'.repeat(level) + ' ';
      text += prefix;
      if (node.content) {
        node.content.forEach(traverse);
      }
      text += '\n\n';
    } else if (node.type === 'bulletList' || node.type === 'orderedList') {
      if (node.content) {
        node.content.forEach((item, index) => {
          const bullet = node.type === 'bulletList' ? '• ' : `${index + 1}. `;
          text += bullet;
          traverse(item);
        });
      }
    } else if (node.type === 'listItem') {
      if (node.content) {
        node.content.forEach(traverse);
      }
      text += '\n';
    } else if (node.content) {
      node.content.forEach(traverse);
    }
  }
  
  if (editorJSON?.content) {
    editorJSON.content.forEach(traverse);
  }
  
  return text.trim();
}

/**
 * Check if editor content has images
 */
function hasImages(editorJSON) {
  let found = false;
  
  function traverse(node) {
    if (node.type === 'image') {
      found = true;
      return;
    }
    if (node.content && !found) {
      node.content.forEach(traverse);
    }
  }
  
  if (editorJSON?.content) {
    editorJSON.content.forEach(traverse);
  }
  
  return found;
}

/**
 * Download entry as TXT file
 */
export async function downloadAsTxt(title, editorContent, metadata = {}) {
  try {
    let text = '';
    
    // Add title
    if (title) {
      text += `${title}\n`;
      text += '='.repeat(title.length) + '\n\n';
    }
    
    // Add metadata
    if (metadata.date) {
      text += `Date: ${metadata.date}\n`;
    }
    if (metadata.mood) {
      text += `Mood: ${metadata.mood}\n`;
    }
    if (metadata.tags && metadata.tags.length > 0) {
      text += `Tags: ${metadata.tags.join(', ')}\n`;
    }
    if (metadata.date || metadata.mood || metadata.tags) {
      text += '\n';
    }
    
    // Add content
    const contentText = typeof editorContent === 'string' 
      ? editorContent 
      : extractTextFromEditorJSON(editorContent);
    text += contentText;
    
    // Create and download file
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title || 'journal-entry'}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    return true;
  } catch (error) {
    console.error('Error downloading as TXT:', error);
    throw new Error('Failed to download as TXT');
  }
}

/**
 * Download entry as PDF file
 */
export async function downloadAsPdf(title, elementId, metadata = {}) {
  try {
    const element = document.getElementById(elementId);
    if (!element) {
      throw new Error('Editor element not found');
    }
    
    // Create a temporary container with better styling for PDF
    const tempContainer = document.createElement('div');
    tempContainer.style.cssText = `
      position: absolute;
      left: -9999px;
      top: 0;
      width: 210mm;
      padding: 20mm;
      background: white;
      font-family: Georgia, serif;
      font-size: 12pt;
      line-height: 1.6;
      color: #333;
    `;
    
    // Add title
    if (title) {
      const titleEl = document.createElement('h1');
      titleEl.textContent = title;
      titleEl.style.cssText = 'margin: 0 0 10px 0; font-size: 24pt; color: #000;';
      tempContainer.appendChild(titleEl);
    }
    
    // Add metadata
    if (metadata.date || metadata.mood || metadata.tags) {
      const metaEl = document.createElement('div');
      metaEl.style.cssText = 'margin-bottom: 20px; padding-bottom: 10px; border-bottom: 1px solid #ddd; font-size: 10pt; color: #666;';
      let metaText = '';
      if (metadata.date) metaText += `Date: ${metadata.date}  `;
      if (metadata.mood) metaText += `Mood: ${metadata.mood}  `;
      if (metadata.tags && metadata.tags.length > 0) metaText += `Tags: ${metadata.tags.join(', ')}`;
      metaEl.textContent = metaText;
      tempContainer.appendChild(metaEl);
    }
    
    // Clone the editor content
    const contentClone = element.cloneNode(true);
    contentClone.style.cssText = 'all: revert; font-family: Georgia, serif; font-size: 12pt; line-height: 1.6;';
    tempContainer.appendChild(contentClone);
    
    document.body.appendChild(tempContainer);
    
    // Convert to canvas
    const canvas = await html2canvas(tempContainer, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    });
    
    // Remove temporary container
    document.body.removeChild(tempContainer);
    
    // Create PDF
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });
    
    const imgWidth = 210; // A4 width in mm
    const pageHeight = 297; // A4 height in mm
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = 0;
    
    // Add first page
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
    
    // Add additional pages if needed
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }
    
    // Download PDF
    pdf.save(`${title || 'journal-entry'}.pdf`);
    
    return true;
  } catch (error) {
    console.error('Error downloading as PDF:', error);
    throw new Error('Failed to download as PDF');
  }
}

/**
 * Smart download - chooses format based on content
 */
export async function downloadEntry(title, editorJSON, elementId, metadata = {}) {
  const hasImg = hasImages(editorJSON);
  
  if (hasImg) {
    return await downloadAsPdf(title, elementId, metadata);
  } else {
    return await downloadAsTxt(title, editorJSON, metadata);
  }
}
