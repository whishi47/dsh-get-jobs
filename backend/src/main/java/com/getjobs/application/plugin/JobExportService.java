package com.getjobs.application.plugin;

import org.apache.poi.ss.usermodel.BorderStyle;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.FillPatternType;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.IndexedColors;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.util.CellRangeAddress;
import org.apache.poi.xssf.streaming.SXSSFWorkbook;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.OutputStream;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;

/**
 * 岗位数据导出为 xlsx。
 *
 * <p>用 {@link SXSSFWorkbook}（流式写出）而不是 XSSFWorkbook：5 万行的全量导出
 * 用内存版会把堆吃满，流式版只在内存里保留 200 行窗口。
 *
 * <p>列顺序与 {@link JobQueryService.JobRow} 对应，跨平台已归一化，所以同一份表里
 * 四个平台的字段含义一致。
 */
@Service
public class JobExportService {

    /** 12 列，顺序即写出顺序。 */
    private static final String[] HEADERS = {
            "平台", "公司", "岗位", "薪资", "地点", "经验",
            "学历", "投递状态", "HR", "链接", "抓取时间", "更新时间"
    };

    /** 各列宽度（字符数），中文用 2 个字符宽估算，略宽于英文。 */
    private static final int[] WIDTHS = {8, 28, 30, 14, 14, 12, 10, 12, 12, 46, 20, 20};

    private final JobQueryService queryService;

    public JobExportService(JobQueryService queryService) {
        this.queryService = queryService;
    }

    /** 建议的下载文件名，带平台与时间戳。 */
    public String fileName(String platform) {
        String stamp = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmm"));
        return "jobs-" + platform + "-" + stamp + ".xlsx";
    }

    /**
     * 把岗位写进输出流。调用方负责 HTTP 头与流的关闭。
     *
     * @param platform 平台标识，{@code "all"} 表示合并
     * @param keyword  关键词过滤，可空
     * @param statuses 状态过滤，可空
     * @return 实际写出的行数（不含表头）
     */
    public int write(String platform, String keyword, String statuses, OutputStream out) throws IOException {
        List<JobQueryService.JobRow> rows = queryService.query(platform, keyword, statuses, JobQueryService.MAX_ROWS);

        SXSSFWorkbook workbook = new SXSSFWorkbook(200);
        try {
            workbook.setCompressTempFiles(true);
            Sheet sheet = workbook.createSheet("岗位数据");

            CellStyle headerStyle = headerStyle(workbook);
            CellStyle bodyStyle = bodyStyle(workbook);

            Row header = sheet.createRow(0);
            for (int column = 0; column < HEADERS.length; column++) {
                Cell cell = header.createCell(column);
                cell.setCellValue(HEADERS[column]);
                cell.setCellStyle(headerStyle);
                sheet.setColumnWidth(column, WIDTHS[column] * 256);
            }
            header.setHeightInPoints(22f);

            int rowIndex = 1;
            for (JobQueryService.JobRow item : rows) {
                Row row = sheet.createRow(rowIndex++);
                String[] values = {
                        label(item.platform()), item.company(), item.title(), item.salary(),
                        item.location(), item.experience(), item.degree(), item.status(),
                        item.hrName(), item.url(), item.createdAt(), item.updatedAt()
                };
                for (int column = 0; column < values.length; column++) {
                    Cell cell = row.createCell(column);
                    cell.setCellValue(values[column] == null ? "" : values[column]);
                    cell.setCellStyle(bodyStyle);
                }
            }

            // 冻结表头 + 自动筛选，5 万行时不至于翻不动
            sheet.createFreezePane(0, 1);
            if (!rows.isEmpty()) {
                sheet.setAutoFilter(new CellRangeAddress(0, rows.size(), 0, HEADERS.length - 1));
            }

            workbook.write(out);
            out.flush();
            return rows.size();
        } finally {
            // 流式工作簿会在临时目录留下分片文件，dispose() 既关底层工作簿也清理临时文件
            workbook.dispose();
        }
    }

    private static CellStyle headerStyle(Workbook workbook) {
        CellStyle style = workbook.createCellStyle();
        Font font = workbook.createFont();
        font.setBold(true);
        font.setFontHeightInPoints((short) 11);
        style.setFont(font);
        style.setFillForegroundColor(IndexedColors.GREY_25_PERCENT.getIndex());
        style.setFillPattern(FillPatternType.SOLID_FOREGROUND);
        style.setBorderBottom(BorderStyle.THIN);
        style.setBottomBorderColor(IndexedColors.GREY_40_PERCENT.getIndex());
        style.setAlignment(org.apache.poi.ss.usermodel.HorizontalAlignment.LEFT);
        style.setVerticalAlignment(org.apache.poi.ss.usermodel.VerticalAlignment.CENTER);
        return style;
    }

    private static CellStyle bodyStyle(Workbook workbook) {
        CellStyle style = workbook.createCellStyle();
        style.setVerticalAlignment(org.apache.poi.ss.usermodel.VerticalAlignment.CENTER);
        style.setWrapText(false);
        return style;
    }

    private static String label(String platform) {
        return switch (platform) {
            case "boss" -> "Boss直聘";
            case "liepin" -> "猎聘";
            case "51job" -> "51job";
            case "zhilian" -> "智联招聘";
            default -> platform;
        };
    }
}
