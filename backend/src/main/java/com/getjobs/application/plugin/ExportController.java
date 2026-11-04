package com.getjobs.application.plugin;

import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.io.OutputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * 岗位数据导出接口，供 DSH 插件的「数据」页使用。
 *
 * <p>与其他控制器一样放行跨域：插件面板在 DSH 的 origin 上，后端在 127.0.0.1:9527，
 * 两者不同源。这里只读数据，无写操作。
 */
@RestController
@RequestMapping("/api/export")
@CrossOrigin(origins = "*")
public class ExportController {

    private static final Logger log = LoggerFactory.getLogger(ExportController.class);

    private final JobExportService exportService;
    private final JobQueryService queryService;

    public ExportController(JobExportService exportService, JobQueryService queryService) {
        this.exportService = exportService;
        this.queryService = queryService;
    }

    /**
     * 导出岗位为 xlsx。
     *
     * @param platform 平台标识，默认 boss；{@code all} 合并四平台
     * @param keyword  公司或岗位关键词，可空
     * @param statuses 投递状态，逗号分隔，可空
     */
    @GetMapping("/jobs")
    public void exportJobs(
            @RequestParam(value = "platform", required = false, defaultValue = "boss") String platform,
            @RequestParam(value = "keyword", required = false) String keyword,
            @RequestParam(value = "statuses", required = false) String statuses,
            HttpServletResponse response
    ) throws IOException {
        // 平台校验必须在拿输出流之前：一旦 getOutputStream() 被关闭，响应就提交了，
        // 后面再 setStatus(400) 也不会生效，客户端只会收到一个空文件。
        if (!"all".equals(platform) && !queryService.supports(platform)) {
            response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"message\":\"未知平台：" + platform + "\"}");
            return;
        }

        String fileName = exportService.fileName(platform);
        response.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        // 中文文件名必须走 RFC 5987 的 filename*，否则某些浏览器会拿到乱码
        response.setHeader("Content-Disposition", "attachment; filename=\"" + fileName + "\"; filename*=UTF-8''"
                + URLEncoder.encode(fileName, StandardCharsets.UTF_8).replace("+", "%20"));
        // 跨域下前端要读文件名，必须显式暴露这个头
        response.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

        try (OutputStream out = response.getOutputStream()) {
            int written = exportService.write(platform, keyword, statuses, out);
            log.info("岗位导出完成: platform={}, rows={}", platform, written);
        }
    }
}
