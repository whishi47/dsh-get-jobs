package com.getjobs.application.plugin;

import com.getjobs.application.service.DeliveryQuotaService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 每日投递配额接口：面板上的「今日已投 / 目标」和手动重置都走这里。
 *
 * <p>只做读写计数，不触发投递 —— 启动/停止仍然在 {@code /api/boss/execute|stop}。
 */
@RestController
@CrossOrigin(origins = "*")
public class DeliveryQuotaController {

    private final DeliveryQuotaService quotaService;

    public DeliveryQuotaController(DeliveryQuotaService quotaService) {
        this.quotaService = quotaService;
    }

    /** 今日进度、目标、剩余额度、是否在允许时间段内。 */
    @GetMapping("/api/delivery/quota")
    public ResponseEntity<Map<String, Object>> quota() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("success", true);
        body.put("data", quotaService.snapshot());
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
}
