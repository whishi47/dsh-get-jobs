package com.getjobs.application.plugin;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 简历解析接口：上传文件 → 抽文本 → 让模型出草稿。
 *
 * <p>返回的是草稿而不是直接写库。写回由 {@code POST /api/ai/apply-draft} 负责，
 * 中间留一步给用户改——模型生成的自我介绍和招呼语，用户必须能过目。
 */
@RestController
@RequestMapping("/api/resume")
@CrossOrigin(origins = "*")
public class ResumeController {

    private static final Logger log = LoggerFactory.getLogger(ResumeController.class);

    private final ResumeTextExtractor extractor;
    private final ResumeDraftService draftService;
    private final ResumeEvaluateService evaluateService;

    public ResumeController(ResumeTextExtractor extractor,
                            ResumeDraftService draftService,
                            ResumeEvaluateService evaluateService) {
        this.extractor = extractor;
        this.draftService = draftService;
        this.evaluateService = evaluateService;
    }

    /** 上传并解析简历。 */
    @PostMapping(value = "/parse", consumes = "multipart/form-data")
    public ResponseEntity<Map<String, Object>> parse(
            @RequestParam(value = "file", required = false) MultipartFile file) {
        // required = false：缺参数时由这里给出可读提示，而不是让 Spring 抛参数异常变成 500
        if (file == null || file.isEmpty()) {
            return error(HttpStatus.BAD_REQUEST, "没有收到文件，请在表单的 file 字段上传简历。");
        }

        ResumeTextExtractor.ExtractResult extracted;
        try (InputStream stream = file.getInputStream()) {
            extracted = extractor.extract(file.getOriginalFilename(), file.getSize(), stream);
        } catch (ResumeTextExtractor.ScannedDocumentException error) {
            // 422：文件格式是对的，但内容没法处理——和"参数错误"要区分开
            return error(HttpStatus.UNPROCESSABLE_ENTITY, error.getMessage());
        } catch (ResumeTextExtractor.UnsupportedResumeException error) {
            return error(HttpStatus.BAD_REQUEST, error.getMessage());
        } catch (IOException error) {
            log.warn("读取上传文件失败: {}", error.getMessage());
            return error(HttpStatus.BAD_REQUEST, "读取文件失败：" + error.getMessage());
        }

        log.info("简历已抽取: format={}, pages={}, chars={}, truncated={}",
                extracted.format(), extracted.pages(), extracted.text().length(), extracted.truncated());

        ResumeDraftService.Draft draft = draftService.generate(extracted.text());

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("format", extracted.format());
        meta.put("pages", extracted.pages());
        meta.put("chars", extracted.text().length());
        meta.put("truncated", extracted.truncated());

        Map<String, Object> draftBody = new LinkedHashMap<>();
        draftBody.put("introduce", draft.introduce());
        draftBody.put("prompt", draft.prompt());
        draftBody.put("sayHi", draft.sayHi());
        draftBody.put("keywords", draft.keywords());
        draftBody.put("cities", draft.cities());
        draftBody.put("notes", draft.notes());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("draft", draftBody);
        body.put("meta", meta);
        return ResponseEntity.ok(body);
    }

    /**
     * 评估简历并打分。
     *
     * <p>和 /parse 分开：解析只出草稿、几乎必成功；评估要模型给结构化评分，
     * 可能因为模型不听话而失败，所以单独一个端点、单独的错误码（502），
     * 前端可以只把这张卡片标红，不影响已经解析出来的草稿。
     */
    @PostMapping("/evaluate")
    public ResponseEntity<Map<String, Object>> evaluate(
            @RequestParam(value = "file", required = false) MultipartFile file) {
        if (file == null || file.isEmpty()) {
            return error(HttpStatus.BAD_REQUEST, "没有收到文件，请在表单的 file 字段上传简历。");
        }

        ResumeTextExtractor.ExtractResult extracted;
        try (InputStream stream = file.getInputStream()) {
            extracted = extractor.extract(file.getOriginalFilename(), file.getSize(), stream);
        } catch (ResumeTextExtractor.ScannedDocumentException error) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, error.getMessage());
        } catch (ResumeTextExtractor.UnsupportedResumeException error) {
            return error(HttpStatus.BAD_REQUEST, error.getMessage());
        } catch (IOException error) {
            log.warn("读取上传文件失败: {}", error.getMessage());
            return error(HttpStatus.BAD_REQUEST, "读取文件失败：" + error.getMessage());
        }

        try {
            Map<String, Object> evaluation = evaluateService.evaluate(extracted.text());

            Map<String, Object> meta = new LinkedHashMap<>();
            meta.put("format", extracted.format());
            meta.put("pages", extracted.pages());
            meta.put("chars", extracted.text().length());
            meta.put("truncated", extracted.truncated());

            Map<String, Object> body = new LinkedHashMap<>();
            body.put("evaluation", evaluation);
            body.put("meta", meta);
            return ResponseEntity.ok(body);
        } catch (IllegalStateException error) {
            // 502：上游模型的问题，不是用户文件的问题
            return error(HttpStatus.BAD_GATEWAY, error.getMessage());
        }
    }

    /** 超过 multipart 上限时给一条明确提示；默认实现会返回 500，前端只能看到"解析失败"。 */
    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<Map<String, Object>> handleTooLarge(MaxUploadSizeExceededException error) {
        return error(HttpStatus.PAYLOAD_TOO_LARGE, "文件超过 10 MB，请压缩后再导入。");
    }

    private static ResponseEntity<Map<String, Object>> error(HttpStatus status, String message) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("message", message == null ? "未知错误" : message);
        return ResponseEntity.status(status).body(body);
    }
}
