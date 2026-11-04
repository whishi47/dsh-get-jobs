package com.getjobs.application.plugin;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.xwpf.usermodel.XWPFParagraph;
import org.apache.poi.xwpf.usermodel.XWPFTable;
import org.apache.poi.xwpf.usermodel.XWPFTableCell;
import org.apache.poi.xwpf.usermodel.XWPFTableRow;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;

/**
 * 从简历文件里抽纯文本。
 *
 * <p>本期只处理有文本层的文件：PDF / DOCX / TXT / MD。扫描件（图片型 PDF、JPG）
 * 会明确抛 {@link ScannedDocumentException}，由上层转成一条可读的提示——而不是
 * 返回一段空文本让用户以为解析成功了。
 */
@Component
public class ResumeTextExtractor {

    /** 上传大小上限，与前端提示一致。 */
    public static final long MAX_BYTES = 10L * 1024 * 1024;

    /** 抽取后的文本上限，超过部分截断，避免把整本简历塞进模型。 */
    public static final int MAX_CHARS = 12_000;

    /** 文本层少于这个字数，几乎必然是没有文字层的扫描件。 */
    private static final int MIN_TEXT_CHARS = 40;

    /** 抽不出文字层的扫描件。 */
    public static class ScannedDocumentException extends RuntimeException {
        public ScannedDocumentException(String message) {
            super(message);
        }
    }

    /** 文件类型不受支持。 */
    public static class UnsupportedResumeException extends RuntimeException {
        public UnsupportedResumeException(String message) {
            super(message);
        }
    }

    /** 抽取结果：正文 + 是否被截断。 */
    public record ExtractResult(String text, boolean truncated, String format, int pages) {}

    /**
     * 按扩展名分派抽取。
     *
     * @param fileName 原始文件名，只用它判断类型
     * @param size     文件字节数，用于前置校验
     * @param stream   文件内容
     */
    public ExtractResult extract(String fileName, long size, InputStream stream) throws IOException {
        if (size > MAX_BYTES) {
            throw new UnsupportedResumeException("文件超过 10 MB，请压缩后再导入。");
        }
        String lower = fileName == null ? "" : fileName.toLowerCase();
        ExtractResult result;
        if (lower.endsWith(".pdf")) {
            result = extractPdf(stream);
        } else if (lower.endsWith(".docx")) {
            result = extractDocx(stream);
        } else if (lower.endsWith(".txt") || lower.endsWith(".md")) {
            result = extractPlain(stream);
        } else if (lower.endsWith(".doc")) {
            throw new UnsupportedResumeException("不支持旧版 .doc，请在 Word 里另存为 .docx 后再导入。");
        } else {
            throw new UnsupportedResumeException("只支持 PDF、DOCX、TXT、MD，当前文件是：" + fileName);
        }

        if (result.text().isBlank()) {
            throw new ScannedDocumentException(
                    "这个文件里没有可提取的文字层。本期不支持 OCR，请从原始编辑器导出文本型 PDF 或 DOCX。");
        }
        return result;
    }

    private ExtractResult extractPdf(InputStream stream) throws IOException {
        try (PDDocument document = PDDocument.load(stream)) {
            int pages = document.getNumberOfPages();
            PDFTextStripper stripper = new PDFTextStripper();
            stripper.setSortByPosition(true);
            String raw = stripper.getText(document);
            String text = normalize(raw);
            if (text.length() < MIN_TEXT_CHARS) {
                throw new ScannedDocumentException(
                        "这个 PDF 共 " + pages + " 页，但只抽到 " + text.length()
                                + " 个字，判断为扫描件。本期不支持 OCR，请导出文本型 PDF。");
            }
            return clip(text, "pdf", pages);
        }
    }

    private ExtractResult extractDocx(InputStream stream) throws IOException {
        try (XWPFDocument document = new XWPFDocument(stream)) {
            StringBuilder builder = new StringBuilder();
            for (XWPFParagraph paragraph : document.getParagraphs()) {
                String line = paragraph.getText();
                if (line != null && !line.isBlank()) builder.append(line).append('\n');
            }
            // 简历常用表格排版，段落抽完还得把单元格内容补进来
            for (XWPFTable table : document.getTables()) {
                for (XWPFTableRow row : table.getRows()) {
                    StringBuilder line = new StringBuilder();
                    for (XWPFTableCell cell : row.getTableCells()) {
                        String value = cell.getText();
                        if (value != null && !value.isBlank()) {
                            if (line.length() > 0) line.append(" | ");
                            line.append(value.strip());
                        }
                    }
                    if (line.length() > 0) builder.append(line).append('\n');
                }
            }
            String text = normalize(builder.toString());
            return clip(text, "docx", 0);
        }
    }

    private ExtractResult extractPlain(InputStream stream) throws IOException {
        byte[] bytes = stream.readAllBytes();
        String text = normalize(decode(bytes));
        return clip(text, "text", 0);
    }

    /**
     * 文本文件解码：先按 UTF-8 严格解，失败再退回 GBK。
     *
     * <p>直接 {@code new String(bytes, UTF_8)} 遇到 GBK 内容会静默产出替换字符，
     * 简历里的中文就全烂了，所以这里用严格解码器判断而不是猜。
     */
    private static String decode(byte[] bytes) {
        int offset = 0;
        if (bytes.length >= 3 && (bytes[0] & 0xFF) == 0xEF && (bytes[1] & 0xFF) == 0xBB && (bytes[2] & 0xFF) == 0xBF) {
            offset = 3;
        }
        try {
            return StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes, offset, bytes.length - offset))
                    .toString();
        } catch (CharacterCodingException ignored) {
            return new String(bytes, offset, bytes.length - offset, Charset.forName("GBK"));
        }
    }

    /** 统一换行、压掉多余空行，让模型看到的文本更干净。 */
    private static String normalize(String raw) {
        if (raw == null) return "";
        return raw.replace("\r\n", "\n")
                .replace('\r', '\n')
                .replace('\u00a0', ' ')
                .replaceAll("[ \t]+\n", "\n")
                .replaceAll("\n{3,}", "\n\n")
                .strip();
    }

    private static ExtractResult clip(String text, String format, int pages) {
        if (text.length() <= MAX_CHARS) {
            return new ExtractResult(text, false, format, pages);
        }
        return new ExtractResult(text.substring(0, MAX_CHARS), true, format, pages);
    }
}
