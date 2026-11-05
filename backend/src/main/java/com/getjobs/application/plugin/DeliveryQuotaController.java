package com.getjobs.application.plugin;

import com.getjobs.application.service.DailyReportService;
import com.getjobs.application.service.DeliveryFailureService;
import com.getjobs.application.service.DeliveryQuotaService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 投递相关的运维接口：每日配额、风控冷却、每日汇报。
 *
 * <p>只读写计数与配置，不触发投递 —— 启动/停止仍然在 {@code /api/boss/execute|stop}。
 */
@RestController
@CrossOrigin(origins = "*")
public class DeliveryQuotaController {

    private final DeliveryQuotaService quotaService;
    private final DailyReportService reportService;
    private final DeliveryFailureService failureService;

    public DeliveryQuotaController(DeliveryQuotaService quotaService,
                                   DailyReportService reportService,
                                   DeliveryFailureService failureService) {
        this.quotaService = quotaService;
        this.reportService = reportService;
        this.failureService = failureService;
    }

    /** 今日进度、目标、剩余额度、是否在允许时间段内、风控冷却状态。 */
    @GetMapping("/api/delivery/quota")
    public ResponseEntity<Map<String, Object>> quota() {
        Map<String, Object> data = new LinkedHashMap<>(quotaService.snapshot());
        // 今日「没投出去」的统计，和配额放在同一个响应里，面板一次请求就够
        Map<String, Object> failures = new LinkedHashMap<>();
        failures.put("total", failureService.todayTotal("boss"));
        failures.put("retryable", failureService.todayRetryableCount("boss"));
        failures.put("byReason", failureService.todayByReason("boss"));
        data.put("failures", failures);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("success", true);
        body.put("data", data);
        return ResponseEntity.ok(body);
    }

    /** 今日失败明细（最多 50 条），给面板排查用。 */
    @GetMapping("/api/delivery/failures")
    public ResponseEntity<Map<String, Object>> failures() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("total", failureService.todayTotal("boss"));
        data.put("retryable", failureService.todayRetryableCount("boss"));
        data.put("byReason", failureService.todayByReason("boss"));
        data.put("items", failureService.todayList("boss", 50));
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("success", true);
        body.put("data", data);
        return ResponseEntity.ok(body);
    }

    /** 清空今日失败记录（重新统计时用）。 */
    @PostMapping("/api/delivery/failures/clear")
    public ResponseEntity<Map<String, Object>> clearFailures() {
        int removed = failureService.clearToday("boss");
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("success", true);
        body.put("message", "已清空今日失败记录（" + removed + " 条）");
        return ResponseEntity.ok(body);
    }

    /** 清零今天的计数（不动历史，也不动目标配置）。 */
    @PostMapping("/api/delivery/quota/reset")
    public ResponseEntity<Map<String, Object>> reset() {
        int removed = quotaService.resetToday();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("success", true);
        body.put("data", quotaService.snapshot());
        body.put("message", "已重置今日投递计数（清理 " + removed + " 条记录）");
        return ResponseEntity.ok(body);
    }

    /** 手动解除风控冷却。 */
    @PostMapping("/api/delivery/cooldown/clear")
    public ResponseEntity<Map<String, Object>> clearCooldown() {
        quotaService.clearCooldown();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("success", true);
        body.put("data", quotaService.snapshot());
        body.put("message", "已解除风控冷却");
        return ResponseEntity.ok(body);
    }

    /** 日报设置与预览。 */
    @GetMapping("/api/delivery/report")
    public ResponseEntity<Map<String, Object>> report() {
        Map<String, Object> data = new LinkedHashMap<>(reportService.status());
        data.put("lastLabel", reportService.lastSentLabel());
        data.put("pastTodayPoint", reportService.pastTodayPoint());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("success", true);
        body.put("data", data);
        return ResponseEntity.ok(body);
    }

    /** 立即推送一次日报。 */
    @PostMapping("/api/delivery/report/send")
    public ResponseEntity<Map<String, Object>> sendReport() {
        Map<String, Object> result = reportService.pushNow();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("success", Boolean.TRUE.equals(result.get("sent")));
        body.put("data", result);
        body.put("message", result.get("message"));
        return ResponseEntity.ok(body);
    }
}
