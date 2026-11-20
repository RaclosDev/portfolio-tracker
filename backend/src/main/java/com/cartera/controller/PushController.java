package com.cartera.controller;

import com.cartera.config.CurrentUser;
import com.cartera.dto.alerts.AlertDtos.OkResponse;
import com.cartera.dto.alerts.AlertDtos.PushDevice;
import com.cartera.dto.alerts.AlertDtos.PushKey;
import com.cartera.dto.alerts.AlertDtos.PushPayload;
import com.cartera.dto.alerts.AlertDtos.SendResult;
import com.cartera.dto.alerts.AlertDtos.SubscribeRequest;
import com.cartera.dto.alerts.AlertDtos.UnsubscribeRequest;
import com.cartera.service.alerts.WebPushService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** Dispositivos suscritos a las notificaciones del navegador. */
@RestController
@RequestMapping("/api/push")
@RequiredArgsConstructor
public class PushController {

    private final WebPushService push;

    @GetMapping("/key")
    public PushKey key() {
        return push.key();
    }

    @GetMapping("/devices")
    public List<PushDevice> devices(@AuthenticationPrincipal CurrentUser user) {
        return push.devices(user.id());
    }

    @PostMapping("/subscribe")
    @ResponseStatus(HttpStatus.CREATED)
    public OkResponse subscribe(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody SubscribeRequest body) {
        push.subscribe(user.id(), body.subscription(), body.label());
        return OkResponse.OK;
    }

    @PostMapping("/unsubscribe")
    public OkResponse unsubscribe(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody UnsubscribeRequest body) {
        push.unsubscribe(user.id(), body.endpoint());
        return OkResponse.OK;
    }

    @DeleteMapping("/devices/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void remove(@AuthenticationPrincipal CurrentUser user, @PathVariable String id) {
        push.remove(user.id(), AlertController.positiveId(id));
    }

    @PostMapping("/test")
    public SendResult test(@AuthenticationPrincipal CurrentUser user) {
        return push.sendAll(user.id(), new PushPayload("Portfolio Tracker",
                "Las notificaciones funcionan en este dispositivo.", "prueba", "/"));
    }
}
