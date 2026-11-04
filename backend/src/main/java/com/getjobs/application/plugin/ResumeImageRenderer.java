package com.getjobs.application.plugin;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Font;
import java.awt.FontMetrics;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * 把简历纯文本排成一张适合手机查看的长图。
 *
 * <p>为什么用 Java2D 而不是前端 Canvas：Boss 的图片简历是后端存的，投递时也是后端去发；
 * 在后端直接生成并落盘，生成完就能被投递流程使用，不需要把图片在浏览器和服务器之间来回传。
 *
 * <p>排版刻意保持简单：白底、深灰正文、顶部标题 + 一条品牌色短线，正文按字符自动换行。
 * 不追求花哨版式，目标是"清楚、能看清、投出去不丢人"。
 */
@Service
public class ResumeImageRenderer {

    private static final Logger log = LoggerFactory.getLogger(ResumeImageRenderer.class);

    /** 手机查看足够清晰，再大只是浪费字节。 */
    private static final int WIDTH = 1080;
    private static final int PADDING = 64;
    private static final int CONTENT_WIDTH = WIDTH - PADDING * 2;
    private static final int TITLE_SIZE = 40;
    private static final int BODY_SIZE = 26;
    /** 超过这个高度会先缩字号、再截断，避免一张图几十 MB。 */
    private static final int MAX_HEIGHT = 12_000;
    /** PNG 超过这个体积就改出 JPEG；Boss 图片简历上限是 10MB。 */
    private static final long MAX_PNG_BYTES = 9L * 1024 * 1024;

    private static final String TITLE = "个人简历";
    private static final String CJK_PROBE = "个人简历工作经历项目技能";

    /** 渲染结果。bytes 已是最终图片（PNG 或 JPEG）。 */
    public record Rendered(byte[] bytes, String format, int width, int height, boolean truncated, int fontSize) {}

    public Rendered render(String resumeText) {
        String text = normalize(resumeText);
        if (text.isBlank()) {
            throw new IllegalArgumentException("简历内容为空，无法生成长图。");
        }

        Font titleFont = pickFont(Font.BOLD, TITLE_SIZE);
        Font bodyFont = pickFont(Font.PLAIN, BODY_SIZE);
        if (bodyFont.canDisplayUpTo(CJK_PROBE) >= 0) {
            throw new IllegalStateException("当前系统缺少可显示中文的字体，无法生成长图。请安装微软雅黑 / 思源黑体后重试。");
        }

        int titleBlock = measureTitleBlock(titleFont);

        // 首选 26px；超长简历逐级缩小，最低 18px
        for (int size : new int[]{BODY_SIZE, 24, 22, 20, 18}) {
            Font font = bodyFont.deriveFont((float) size);
            int lineHeight = Math.round(size * 1.85f);
            List<String> lines = layout(text, font);
            int height = PADDING * 2 + titleBlock + lines.size() * lineHeight;
            if (height <= MAX_HEIGHT) {
                return paint(titleFont, font, lines, lineHeight, height, false);
            }
        }

        // 最小字号仍超长：截断并标记
        Font font = bodyFont.deriveFont(18f);
        int lineHeight = Math.round(18 * 1.85f);
        List<String> all = layout(text, font);
        int maxLines = Math.max(1, (MAX_HEIGHT - PADDING * 2 - titleBlock) / lineHeight);
        boolean truncated = all.size() > maxLines;
        List<String> lines = truncated ? new ArrayList<>(all.subList(0, maxLines)) : all;
        int height = PADDING * 2 + titleBlock + lines.size() * lineHeight;
        log.info("简历长图触发高度上限: {} 行 → {} 行, truncated={}", all.size(), lines.size(), truncated);
        return paint(titleFont, font, lines, lineHeight, height, truncated);
    }

    /** 统一换行、压缩连续空行，避免 PDF 抽出来的文本带一堆空白。 */
    private static String normalize(String text) {
        if (text == null) return "";
        String normalized = text.replace("\r\n", "\n").replace('\r', '\n');
        normalized = normalized.replace('\u00a0', ' ').replace('\t', ' ');
        StringBuilder out = new StringBuilder(normalized.length());
        boolean lastBlank = false;
        for (String line : normalized.split("\n", -1)) {
            String stripped = line.stripTrailing();
            boolean blank = stripped.isBlank();
            if (blank && lastBlank) continue;
            out.append(stripped).append('\n');
            lastBlank = blank;
        }
        return out.toString().strip();
    }

    private static int measureTitleBlock(Font titleFont) {
        BufferedImage probe = new BufferedImage(1, 1, BufferedImage.TYPE_INT_RGB);
        Graphics2D graphics = probe.createGraphics();
        try {
            graphics.setFont(titleFont);
            FontMetrics metrics = graphics.getFontMetrics();
            // 标题高度 + 间距 + 短线 + 与正文的间距
            return metrics.getHeight() + 12 + 4 + 32;
        } finally {
            graphics.dispose();
        }
    }

    /** 折行：中文按字符、英文按字符兜底，够用且不会出现半行溢出。 */
    private static List<String> layout(String text, Font font) {
        BufferedImage probe = new BufferedImage(1, 1, BufferedImage.TYPE_INT_RGB);
        Graphics2D graphics = probe.createGraphics();
        try {
            graphics.setFont(font);
            FontMetrics metrics = graphics.getFontMetrics();
            List<String> lines = new ArrayList<>();
            for (String raw : text.split("\n", -1)) {
                if (raw.isBlank()) {
                    lines.add("");
                    continue;
                }
                lines.addAll(wrap(raw, metrics));
            }
            return lines;
        } finally {
            graphics.dispose();
        }
    }

    /** 允许断行的字符：空格与常见中英文标点，避免把 Sentinel 拆成 Sentin/el。 */
    private static final String BREAK_CHARS = " ，。；：、,.;:!?！？/）)】」";

    private static List<String> wrap(String line, FontMetrics metrics) {
        List<String> out = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        int lastBreak = -1;

        for (int index = 0; index < line.length(); ) {
            int codePoint = line.codePointAt(index);
            String chunk = new String(Character.toChars(codePoint));

            if (current.length() > 0 && metrics.stringWidth(current + chunk) > CONTENT_WIDTH) {
                if (lastBreak > 0 && lastBreak < current.length()) {
                    // 在最近的空格/标点处断，英文单词保持完整
                    String head = current.substring(0, lastBreak).stripTrailing();
                    String tail = current.substring(lastBreak).stripLeading();
                    if (!head.isEmpty()) out.add(head);
                    current.setLength(0);
                    current.append(tail);
                } else {
                    // 整行没有断点（超长英文串）：退化为按字符切
                    out.add(current.toString());
                    current.setLength(0);
                }
                lastBreak = -1;
            }

            current.append(chunk);
            if (BREAK_CHARS.indexOf(codePoint) >= 0) lastBreak = current.length();
            index += Character.charCount(codePoint);
        }
        if (current.length() > 0) {
            String tail = current.toString().stripTrailing();
            if (!tail.isEmpty()) out.add(tail);
        }
        return out;
    }

    private Rendered paint(Font titleFont, Font bodyFont, List<String> lines, int lineHeight, int height, boolean truncated) {
        BufferedImage image = new BufferedImage(WIDTH, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D graphics = image.createGraphics();
        try {
            graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            graphics.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
            graphics.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);

            graphics.setColor(Color.WHITE);
            graphics.fillRect(0, 0, WIDTH, height);

            int y = PADDING;
            graphics.setFont(titleFont);
            FontMetrics titleMetrics = graphics.getFontMetrics();
            graphics.setColor(new Color(0x101828));
            graphics.drawString(TITLE, PADDING, y + titleMetrics.getAscent());
            y += titleMetrics.getHeight() + 12;

            graphics.setColor(new Color(0x2F6FEB));
            graphics.fillRect(PADDING, y, 72, 4);
            y += 4 + 32;

            graphics.setFont(bodyFont);
            FontMetrics bodyMetrics = graphics.getFontMetrics();
            graphics.setColor(new Color(0x344054));
            for (String line : lines) {
                if (!line.isEmpty()) {
                    graphics.drawString(line, PADDING, y + bodyMetrics.getAscent());
                }
                y += lineHeight;
            }
        } finally {
            graphics.dispose();
        }

        byte[] bytes = encode(image, "png");
        String format = "png";
        if (bytes.length > MAX_PNG_BYTES) {
            byte[] jpeg = encode(image, "jpg");
            if (jpeg.length > 0 && jpeg.length < bytes.length) {
                bytes = jpeg;
                format = "jpg";
            }
        }
        return new Rendered(bytes, format, WIDTH, height, truncated, bodyFont.getSize());
    }

    private static byte[] encode(BufferedImage image, String format) {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            if (!ImageIO.write(image, format, out)) {
                throw new IllegalStateException("图片编码失败：缺少 " + format + " 编码器");
            }
            return out.toByteArray();
        } catch (IOException error) {
            throw new IllegalStateException("图片编码失败：" + error.getMessage(), error);
        }
    }

    /**
     * 挑一个能显示中文的字体。Windows / macOS / Linux 的常见中文字体都试一遍，
     * 最后退回逻辑字体 —— 逻辑字体在多数 JDK 发行版里也带 CJK fallback。
     */
    private static Font pickFont(int style, int size) {
        String[] candidates = {
                "Microsoft YaHei", "微软雅黑",
                "PingFang SC", "Hiragino Sans GB",
                "Noto Sans CJK SC", "Source Han Sans SC", "Noto Sans SC",
                "WenQuanYi Micro Hei", "SimHei", "SimSun",
        };
        for (String name : candidates) {
            Font font = new Font(name, style, size);
            if (font.canDisplayUpTo(CJK_PROBE) < 0) return font;
        }
        Font logical = new Font(Font.SANS_SERIF, style, size);
        if (logical.canDisplayUpTo(CJK_PROBE) < 0) return logical;
        return logical;
    }
}
