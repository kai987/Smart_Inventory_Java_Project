package com.kai987.smartinventory.web.mapper;

import java.util.List;

import org.springframework.stereotype.Component;

import com.kai987.smartinventory.domain.Order;
import com.kai987.smartinventory.domain.OrderItem;
import com.kai987.smartinventory.domain.Product;
import com.kai987.smartinventory.domain.User;
import com.kai987.smartinventory.web.dto.auth.UserResponse;
import com.kai987.smartinventory.web.dto.order.OrderItemResponse;
import com.kai987.smartinventory.web.dto.order.OrderResponse;
import com.kai987.smartinventory.web.dto.product.ProductResponse;

@Component
public class ApiMapper {
    public ProductResponse toProduct(Product product) {
        return new ProductResponse(product.getId(), product.getName(),
                Long.toString(product.getPriceYen()), product.getStock(), product.getWeightKg(),
                product.getStock() > 0);
    }

    public UserResponse toUser(User user) {
        return new UserResponse(user.getUsername(), user.getRole().name());
    }

    public OrderResponse toOrder(Order order) {
        List<OrderItemResponse> items = order.getItems().stream().map(this::toOrderItem).toList();
        return new OrderResponse(order.getOrderId(), order.getCustomerName(), items,
                Long.toString(order.getTotalPriceYen()), order.getTotalWeightKg(),
                order.getEstimatedBoxes());
    }

    private OrderItemResponse toOrderItem(OrderItem item) {
        return new OrderItemResponse(item.getProductId(), item.getProductName(),
                Long.toString(item.getUnitPriceYen()), item.getUnitWeightKg(), item.getQuantity(),
                Long.toString(item.getSubtotalYen()), item.getTotalWeightKg());
    }
}
