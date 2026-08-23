package com.kai987.smartinventory.web.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.kai987.smartinventory.service.DashboardService;
import com.kai987.smartinventory.web.dto.admin.AdminSummaryResponse;

@RestController
@RequestMapping("/api/admin")
public class AdminController {
    private final DashboardService dashboardService;

    public AdminController(DashboardService dashboardService) {
        this.dashboardService = dashboardService;
    }

    @GetMapping("/summary")
    public AdminSummaryResponse summary() {
        return dashboardService.summary();
    }
}
