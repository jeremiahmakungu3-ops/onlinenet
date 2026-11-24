import { jsPDF } from 'jspdf';
import type { Site, Voucher } from '../../packages/shared/types';

export interface VoucherPdfOptions {
  vouchers: Voucher[];
  sites: Site[];
  organizationName?: string;
  filename?: string;
}

export function downloadVouchersPdf({
  vouchers,
  sites,
  organizationName = 'XCLOUD.NET Tanzania',
  filename,
}: VoucherPdfOptions): void {
  if (vouchers.length === 0) return;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 12;
  const headerY = 14;
  const cols = 3;
  const rowsPerPage = 5;
  const cardsPerPage = cols * rowsPerPage;
  const gapX = 5;
  const gapY = 5;
  const cardWidth = (pageWidth - marginX * 2 - gapX * (cols - 1)) / cols;
  const cardHeight = 46;
  const gridStartY = 24;

  const siteMap = new Map(sites.map((s) => [s.id, s]));

  const drawPageHeader = (pageNumber: number, totalPages: number) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(`${organizationName} — WiFi Voucher Sheet`, marginX, headerY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    const metaText = `Generated ${new Date().toLocaleDateString('en-GB')} · ${vouchers.length} voucher(s) · Page ${pageNumber}/${totalPages}`;
    doc.text(metaText, pageWidth - marginX, headerY, { align: 'right' });

    doc.setDrawColor(226, 232, 240);
    doc.line(marginX, headerY + 3.5, pageWidth - marginX, headerY + 3.5);
  };

  const totalPages = Math.ceil(vouchers.length / cardsPerPage);

  vouchers.forEach((voucher, index) => {
    const pageIndex = Math.floor(index / cardsPerPage);
    const slotOnPage = index % cardsPerPage;

    if (index > 0 && slotOnPage === 0) {
      doc.addPage();
    }
    if (slotOnPage === 0) {
      drawPageHeader(pageIndex + 1, totalPages);
    }

    const col = slotOnPage % cols;
    const row = Math.floor(slotOnPage / cols);
    const x = marginX + col * (cardWidth + gapX);
    const y = gridStartY + row * (cardHeight + gapY);

    const site = siteMap.get(voucher.siteId);
    const ssid = site?.ssid || 'XCLOUD-WIFI';

    // Card outline (cut line)
    doc.setDrawColor(203, 213, 225);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, cardWidth, cardHeight, 2, 2, 'FD');

    // Top accent strip
    doc.setFillColor(29, 78, 216);
    doc.rect(x, y, cardWidth, 6.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text(`SSID: ${ssid}`, x + 3, y + 4.4);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text(`TZS ${voucher.priceTzs.toLocaleString()}`, x + cardWidth - 3, y + 4.4, { align: 'right' });

    // Package & Site
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(voucher.packageName, x + 3, y + 12.5, { maxWidth: cardWidth - 6 });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    const truncatedSite = voucher.siteName.length > 30 ? `${voucher.siteName.slice(0, 29)}…` : voucher.siteName;
    doc.text(truncatedSite, x + 3, y + 17);

    // Voucher code box
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x + 3, y + 20, cardWidth - 6, 12, 1.5, 1.5, 'FD');

    doc.setFont('courier', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text(voucher.code, x + cardWidth / 2, y + 27.5, { align: 'center' });

    // Instructions & batch footer
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(71, 85, 105);
    doc.text('1. Connect to WiFi   2. Enter voucher code', x + 3, y + 37.5);

    doc.setFont('courier', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(148, 163, 184);
    doc.text(`${voucher.batchId} · ${voucher.status}`, x + 3, y + 42.5);
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(148, 163, 184);
  doc.text('XCLOUD.NET Tanzania · Cut along card borders for counter distribution', marginX, pageHeight - 8);

  const safeDate = new Date().toISOString().slice(0, 10);
  doc.save(filename || `xcloud-vouchers-${safeDate}.pdf`);
}
