# Sprint 1: System Architecture & Scope Definition

**Project Name:** Root & Sprout – Curated Botanical Nursery & Care Hub  
**Document File:** `SPRINT_1.md`

---

## Section 1: Target Audience & Market Focus

* **Primary Persona:**
  * **Profile:** Sarah Lin, 28, urban apartment resident and remote professional.
  * **Demographics & Behavior:** Tech-literate consumer focused on interior wellness, modern living space aesthetics, and reliable online shopping.
  * **Constraints:** Low-to-moderate indirect sunlight in living quarters, cohabitation with domestic pets, and minimal prior botanical knowledge requiring clear maintenance instructions.
* **Core Pain Point:**
  * Standard e-commerce platforms fail to provide vital environmental parameters (e.g., pet safety ratings, sunlight compatibility, watering intervals) alongside plant listings, resulting in frequent plant mortality and mismatched potting accessories.
* **Domain Scope:**[cite: 1]
  * A specialized retail platform delivering indoor foliage (low-light, pet-friendly, air-purifying), matching drainage planters, specialized soil substrates, and organic botanical care supplies[cite: 1].

---

## Section 2: Minimum Viable Product (MVP) Feature Scope[cite: 1]

| Category | Feature Name | Description | Priority |
| :--- | :--- | :--- | :--- |
| Authentication[cite: 1] | User Registration & Authentication[cite: 1] | Password hashing and JWT-based authentication mechanism with role-based access control (Customer vs. Admin)[cite: 1]. | High (MVP)[cite: 1] |
| Catalog[cite: 1] | Product List & Search[cite: 1] | Product browsing interface with taxonomy-based filtering (light requirements, pet friendliness, pot sizes) and text search[cite: 1]. | High (MVP)[cite: 1] |
| Cart[cite: 1] | Cart Management[cite: 1] | State persistent cart management (item addition, modification, and deletion) with dynamic subtotal calculations[cite: 1]. | High (MVP)[cite: 1] |
| Checkout[cite: 1] | Order Processing[cite: 1] | Mock or Stripe payment gateway integration, real-time transactional inventory decrement, and order object instantiation[cite: 1]. | High (MVP)[cite: 1] |
| Admin[cite: 1] | Inventory Control[cite: 1] | Administrative CRUD operations for product inventory, restock tracking, and category taxonomy management[cite: 1]. | Medium[cite: 1] |

---

## Section 3: Tech Stack Selection & Justification[cite: 1]

* **Frontend Framework:** React (with Vite)[cite: 1]
  * *Justification:* React offers a component-driven architecture and responsive client state management essential for multi-faceted catalog filtering and real-time cart updates without page reloads[cite: 1]. Its extensive ecosystem, rapid virtual DOM updates, and strong community support accelerate frontend delivery while maintaining a seamless user experience across devices[cite: 1].
* **Backend Infrastructure:** Node.js with Express[cite: 1]
  * *Justification:* Node.js provides a high-throughput, non-blocking asynchronous event loop that efficiently manages concurrent product browsing and checkout operations[cite: 1]. Express offers lightweight, transparent routing, straightforward RESTful API endpoint configuration, and flexible middleware for JWT authorization and role verification[cite: 1].
* **Database Management System:** PostgreSQL[cite: 1]
  * *Justification:* PostgreSQL delivers strict ACID compliance and row-level locking mechanisms critical for transactional integrity during simultaneous cart checkouts and inventory deductions[cite: 1]. Relational foreign key constraints natively enforce data consistency between accounts, catalog entities, and order line items, providing reliability that non-relational alternatives lack[cite: 1].
* **Caching & Asynchronous Processing (Optional):** Redis[cite: 1]
  * *Justification:* Implemented as an in-memory key-value cache to store active shopping sessions and cache frequent catalog query results, reducing load on the primary relational database[cite: 1].

---

## Section 4: Entity-Relationship Diagram (ERD)[cite: 1]

```mermaid
erDiagram
    USERS ||--o{ ORDERS : places
    USERS ||--o| CARTS : owns
    CARTS ||--o{ CART_ITEMS : contains
    PRODUCTS ||--o{ CART_ITEMS : added_to
    CATEGORIES ||--o{ PRODUCTS : categorizes
    ORDERS ||--|{ ORDER_ITEMS : contains
    PRODUCTS ||--o{ ORDER_ITEMS : ordered_in

    USERS {
        int id PK
        string full_name
        string email UK
        string password_hash
        string role
        string shipping_address
        timestamp created_at
    }

    CATEGORIES {
        int id PK
        string name
        string slug UK
        string description
    }

    PRODUCTS {
        int id PK
        int category_id FK
        string name
        string sku UK
        decimal price
        int stock_quantity
        string light_requirement
        boolean is_pet_friendly
        string image_url
        string description
        timestamp created_at
    }

    CARTS {
        int id PK
        int user_id FK
        timestamp updated_at
    }

    CART_ITEMS {
        int id PK
        int cart_id FK
        int product_id FK
        int quantity
    }

    ORDERS {
        int id PK
        int user_id FK
        decimal total_amount
        string order_status
        string shipping_address
        timestamp created_at
    }

    ORDER_ITEMS {
        int id PK
        int order_id FK
        int product_id FK
        int quantity
        decimal unit_price
    }