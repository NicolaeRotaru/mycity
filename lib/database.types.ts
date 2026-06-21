// AUTO-GENERATO da scripts/gen-db-types.mjs — NON modificare a mano.
// Fonte: migrations/*.sql. Rigenerare con: node scripts/gen-db-types.mjs
// Sostituto offline di `supabase gen types` (no DB access richiesto).
// CAVEAT: riflette le migrations, non modifiche manuali via dashboard.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      abandoned_carts: {
        Row: {
          user_id: string;
          cart_data: Json;
          cart_total: number;
          last_activity: string;
          recovery_email_sent_at: string | null;
          recovered: boolean;
        };
        Insert: {
          user_id: string;
          cart_data: Json;
          cart_total?: number;
          last_activity?: string;
          recovery_email_sent_at?: string | null;
          recovered?: boolean;
        };
        Update: {
          user_id?: string;
          cart_data?: Json;
          cart_total?: number;
          last_activity?: string;
          recovery_email_sent_at?: string | null;
          recovered?: boolean;
        };
        Relationships: [];
      };
      achievements: {
        Row: {
          id: string;
          title: string;
          description: string;
          icon: string;
          points_reward: number;
          tier: string;
          target_role: string | null;
          sort_order: number;
        };
        Insert: {
          id: string;
          title: string;
          description: string;
          icon: string;
          points_reward?: number;
          tier?: string;
          target_role?: string | null;
          sort_order?: number;
        };
        Update: {
          id?: string;
          title?: string;
          description?: string;
          icon?: string;
          points_reward?: number;
          tier?: string;
          target_role?: string | null;
          sort_order?: number;
        };
        Relationships: [];
      };
      activity_events: {
        Row: {
          id: string;
          category: string;
          event_type: string;
          action: string | null;
          summary: string | null;
          actor_id: string | null;
          user_id: string | null;
          anon_id: string | null;
          session_id: string | null;
          target_table: string | null;
          target_id: string | null;
          path: string | null;
          referrer: string | null;
          ip: string | null;
          user_agent: string | null;
          device_type: string | null;
          browser: string | null;
          os: string | null;
          country: string | null;
          city: string | null;
          is_bot: boolean;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          category: string;
          event_type: string;
          action?: string | null;
          summary?: string | null;
          actor_id?: string | null;
          user_id?: string | null;
          anon_id?: string | null;
          session_id?: string | null;
          target_table?: string | null;
          target_id?: string | null;
          path?: string | null;
          referrer?: string | null;
          ip?: string | null;
          user_agent?: string | null;
          device_type?: string | null;
          browser?: string | null;
          os?: string | null;
          country?: string | null;
          city?: string | null;
          is_bot?: boolean;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          category?: string;
          event_type?: string;
          action?: string | null;
          summary?: string | null;
          actor_id?: string | null;
          user_id?: string | null;
          anon_id?: string | null;
          session_id?: string | null;
          target_table?: string | null;
          target_id?: string | null;
          path?: string | null;
          referrer?: string | null;
          ip?: string | null;
          user_agent?: string | null;
          device_type?: string | null;
          browser?: string | null;
          os?: string | null;
          country?: string | null;
          city?: string | null;
          is_bot?: boolean;
          metadata?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: string;
          actor_id: string | null;
          action: string;
          target_table: string | null;
          target_id: string | null;
          metadata: Json | null;
          ip: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_id?: string | null;
          action: string;
          target_table?: string | null;
          target_id?: string | null;
          metadata?: Json | null;
          ip?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          actor_id?: string | null;
          action?: string;
          target_table?: string | null;
          target_id?: string | null;
          metadata?: Json | null;
          ip?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      business_orders: {
        Row: {
          id: string;
          order_id: string;
          company_name: string;
          vat_number: string;
          sdi_code: string | null;
          pec: string | null;
          invoice_required: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          company_name: string;
          vat_number: string;
          sdi_code?: string | null;
          pec?: string | null;
          invoice_required?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          company_name?: string;
          vat_number?: string;
          sdi_code?: string | null;
          pec?: string | null;
          invoice_required?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      cashback_campaigns: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          trigger_event: string;
          target_category_id: string | null;
          bonus_points: number;
          valid_hours: number;
          starts_at: string;
          ends_at: string;
          min_order_cents: number;
          status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          trigger_event: string;
          target_category_id?: string | null;
          bonus_points?: number;
          valid_hours?: number;
          starts_at?: string;
          ends_at?: string;
          min_order_cents?: number;
          status?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          trigger_event?: string;
          target_category_id?: string | null;
          bonus_points?: number;
          valid_hours?: number;
          starts_at?: string;
          ends_at?: string;
          min_order_cents?: number;
          status?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      cashback_redemptions: {
        Row: {
          campaign_id: string;
          user_id: string;
          order_id: string | null;
          points_awarded: number;
          awarded_at: string;
        };
        Insert: {
          campaign_id: string;
          user_id: string;
          order_id?: string | null;
          points_awarded: number;
          awarded_at?: string;
        };
        Update: {
          campaign_id?: string;
          user_id?: string;
          order_id?: string | null;
          points_awarded?: number;
          awarded_at?: string;
        };
        Relationships: [];
      };
      catalog_ai_jobs: {
        Row: {
          id: string;
          seller_id: string;
          operation: string;
          status: string;
          batch_id: string | null;
          target_lang: string | null;
          total: number;
          results: Json;
          error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          seller_id: string;
          operation: string;
          status?: string;
          batch_id?: string | null;
          target_lang?: string | null;
          total?: number;
          results?: Json;
          error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          seller_id?: string;
          operation?: string;
          status?: string;
          batch_id?: string | null;
          target_lang?: string | null;
          total?: number;
          results?: Json;
          error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          id: string;
          slug: string;
          name: string;
          parent_id: string | null;
          icon: string | null;
          created_at: string | null;
          sort_order: number;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          parent_id?: string | null;
          icon?: string | null;
          created_at?: string | null;
          sort_order?: number;
        };
        Update: {
          id?: string;
          slug?: string;
          name?: string;
          parent_id?: string | null;
          icon?: string | null;
          created_at?: string | null;
          sort_order?: number;
        };
        Relationships: [];
      };
      cms_pages: {
        Row: {
          slug: string;
          title: string;
          sections: Json;
          status: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          slug: string;
          title?: string;
          sections?: Json;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          slug?: string;
          title?: string;
          sections?: Json;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      cod_reconciliations: {
        Row: {
          id: string;
          rider_id: string;
          for_date: string;
          expected_cents: number;
          collected_cents: number;
          delta_cents: number | null;
          status: string;
          notes: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string | null;
          remitted_at: string | null;
        };
        Insert: {
          id?: string;
          rider_id: string;
          for_date: string;
          expected_cents?: number;
          collected_cents?: number;
          delta_cents?: number | null;
          status?: string;
          notes?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string | null;
          remitted_at?: string | null;
        };
        Update: {
          id?: string;
          rider_id?: string;
          for_date?: string;
          expected_cents?: number;
          collected_cents?: number;
          delta_cents?: number | null;
          status?: string;
          notes?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string | null;
          remitted_at?: string | null;
        };
        Relationships: [];
      };
      contact_messages: {
        Row: {
          id: string;
          name: string;
          email: string;
          subject: string;
          message: string;
          status: string;
          user_id: string | null;
          admin_notes: string | null;
          handled_by: string | null;
          handled_at: string | null;
          ip: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          email: string;
          subject?: string;
          message: string;
          status?: string;
          user_id?: string | null;
          admin_notes?: string | null;
          handled_by?: string | null;
          handled_at?: string | null;
          ip?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          email?: string;
          subject?: string;
          message?: string;
          status?: string;
          user_id?: string | null;
          admin_notes?: string | null;
          handled_by?: string | null;
          handled_at?: string | null;
          ip?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          buyer_id: string;
          seller_id: string;
          last_message_at: string;
          last_message_preview: string | null;
          buyer_unread_count: number;
          seller_unread_count: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          buyer_id: string;
          seller_id: string;
          last_message_at?: string;
          last_message_preview?: string | null;
          buyer_unread_count?: number;
          seller_unread_count?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          buyer_id?: string;
          seller_id?: string;
          last_message_at?: string;
          last_message_preview?: string | null;
          buyer_unread_count?: number;
          seller_unread_count?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      coupons: {
        Row: {
          id: string;
          code: string;
          type: string;
          value: number;
          min_subtotal: number | null;
          max_uses: number | null;
          uses_count: number | null;
          first_order_only: boolean | null;
          expires_at: string | null;
          active: boolean | null;
          description: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          code: string;
          type: string;
          value?: number;
          min_subtotal?: number | null;
          max_uses?: number | null;
          uses_count?: number | null;
          first_order_only?: boolean | null;
          expires_at?: string | null;
          active?: boolean | null;
          description?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          code?: string;
          type?: string;
          value?: number;
          min_subtotal?: number | null;
          max_uses?: number | null;
          uses_count?: number | null;
          first_order_only?: boolean | null;
          expires_at?: string | null;
          active?: boolean | null;
          description?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      cron_heartbeats: {
        Row: {
          name: string;
          last_run_at: string;
        };
        Insert: {
          name: string;
          last_run_at?: string;
        };
        Update: {
          name?: string;
          last_run_at?: string;
        };
        Relationships: [];
      };
      daily_drops: {
        Row: {
          id: string;
          product_id: string;
          drop_date: string;
          discount_percent: number;
          original_price: number;
          drop_price: number;
          headline: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          drop_date: string;
          discount_percent: number;
          original_price: number;
          drop_price: number;
          headline?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          product_id?: string;
          drop_date?: string;
          discount_percent?: number;
          original_price?: number;
          drop_price?: number;
          headline?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      daily_stories: {
        Row: {
          id: string;
          seller_id: string;
          feature_date: string;
          title: string;
          body: string;
          image_url: string | null;
          cta_label: string | null;
          cta_url: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          seller_id: string;
          feature_date: string;
          title: string;
          body: string;
          image_url?: string | null;
          cta_label?: string | null;
          cta_url?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          seller_id?: string;
          feature_date?: string;
          title?: string;
          body?: string;
          image_url?: string | null;
          cta_label?: string | null;
          cta_url?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      disputes: {
        Row: {
          id: string;
          order_id: string;
          opener_id: string;
          against_id: string | null;
          reason: string;
          description: string;
          status: string;
          resolution_notes: string | null;
          resolved_by: string | null;
          resolved_at: string | null;
          refund_cents: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          opener_id: string;
          against_id?: string | null;
          reason: string;
          description: string;
          status?: string;
          resolution_notes?: string | null;
          resolved_by?: string | null;
          resolved_at?: string | null;
          refund_cents?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          opener_id?: string;
          against_id?: string | null;
          reason?: string;
          description?: string;
          status?: string;
          resolution_notes?: string | null;
          resolved_by?: string | null;
          resolved_at?: string | null;
          refund_cents?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      email_queue: {
        Row: {
          id: string;
          user_id: string;
          template: string;
          send_at: string;
          sent_at: string | null;
          cancelled_at: string | null;
          metadata: Json | null;
          created_at: string;
          claimed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          template: string;
          send_at: string;
          sent_at?: string | null;
          cancelled_at?: string | null;
          metadata?: Json | null;
          created_at?: string;
          claimed_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          template?: string;
          send_at?: string;
          sent_at?: string | null;
          cancelled_at?: string | null;
          metadata?: Json | null;
          created_at?: string;
          claimed_at?: string | null;
        };
        Relationships: [];
      };
      event_rsvps: {
        Row: {
          user_id: string;
          event_id: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          event_id: string;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          event_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      favorites: {
        Row: {
          user_id: string;
          product_id: string;
          created_at: string | null;
        };
        Insert: {
          user_id: string;
          product_id: string;
          created_at?: string | null;
        };
        Update: {
          user_id?: string;
          product_id?: string;
          created_at?: string | null;
        };
        Relationships: [];
      };
      follows: {
        Row: {
          user_id: string;
          store_id: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          store_id: string;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          store_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      gift_cards: {
        Row: {
          code: string;
          amount_cents: number;
          balance_cents: number;
          buyer_id: string | null;
          recipient_email: string | null;
          recipient_name: string | null;
          message: string | null;
          redeemed_by: string | null;
          redeemed_at: string | null;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          code: string;
          amount_cents: number;
          balance_cents: number;
          buyer_id?: string | null;
          recipient_email?: string | null;
          recipient_name?: string | null;
          message?: string | null;
          redeemed_by?: string | null;
          redeemed_at?: string | null;
          expires_at?: string;
          created_at?: string;
        };
        Update: {
          code?: string;
          amount_cents?: number;
          balance_cents?: number;
          buyer_id?: string | null;
          recipient_email?: string | null;
          recipient_name?: string | null;
          message?: string | null;
          redeemed_by?: string | null;
          redeemed_at?: string | null;
          expires_at?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      group_orders: {
        Row: {
          id: string;
          product_id: string;
          seller_id: string;
          organizer_id: string;
          title: string | null;
          target_quantity: number;
          current_quantity: number;
          discount_percent: number;
          unit_price: number;
          discounted_price: number;
          deadline: string;
          status: string;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          product_id: string;
          seller_id: string;
          organizer_id: string;
          title?: string | null;
          target_quantity: number;
          current_quantity?: number;
          discount_percent: number;
          unit_price: number;
          discounted_price: number;
          deadline: string;
          status?: string;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          product_id?: string;
          seller_id?: string;
          organizer_id?: string;
          title?: string | null;
          target_quantity?: number;
          current_quantity?: number;
          discount_percent?: number;
          unit_price?: number;
          discounted_price?: number;
          deadline?: string;
          status?: string;
          created_at?: string | null;
        };
        Relationships: [];
      };
      group_participants: {
        Row: {
          id: string;
          group_order_id: string;
          user_id: string;
          quantity: number;
          joined_at: string | null;
        };
        Insert: {
          id?: string;
          group_order_id: string;
          user_id: string;
          quantity?: number;
          joined_at?: string | null;
        };
        Update: {
          id?: string;
          group_order_id?: string;
          user_id?: string;
          quantity?: number;
          joined_at?: string | null;
        };
        Relationships: [];
      };
      invoice_sequences: {
        Row: {
          seller_id: string;
          year: number;
          last_number: number;
          updated_at: string | null;
        };
        Insert: {
          seller_id: string;
          year: number;
          last_number?: number;
          updated_at?: string | null;
        };
        Update: {
          seller_id?: string;
          year?: number;
          last_number?: number;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      loyalty_accounts: {
        Row: {
          user_id: string;
          points_balance: number;
          lifetime_earned: number;
          tier: string;
          streak_days: number;
          last_visit_date: string | null;
          longest_streak: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          points_balance?: number;
          lifetime_earned?: number;
          tier?: string;
          streak_days?: number;
          last_visit_date?: string | null;
          longest_streak?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          points_balance?: number;
          lifetime_earned?: number;
          tier?: string;
          streak_days?: number;
          last_visit_date?: string | null;
          longest_streak?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      loyalty_transactions: {
        Row: {
          id: string;
          user_id: string;
          delta: number;
          reason: string;
          order_id: string | null;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          delta: number;
          reason: string;
          order_id?: string | null;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          delta?: number;
          reason?: string;
          order_id?: string | null;
          metadata?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
      marketplace_events: {
        Row: {
          id: string;
          title: string;
          description: string;
          cover_image_url: string | null;
          starts_at: string;
          ends_at: string;
          discount_percent: number | null;
          sponsor_seller_id: string | null;
          cta_label: string | null;
          cta_url: string | null;
          status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          description: string;
          cover_image_url?: string | null;
          starts_at: string;
          ends_at: string;
          discount_percent?: number | null;
          sponsor_seller_id?: string | null;
          cta_label?: string | null;
          cta_url?: string | null;
          status?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          description?: string;
          cover_image_url?: string | null;
          starts_at?: string;
          ends_at?: string;
          discount_percent?: number | null;
          sponsor_seller_id?: string | null;
          cta_label?: string | null;
          cta_url?: string | null;
          status?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          sender_id: string;
          body: string;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          sender_id: string;
          body: string;
          read_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          sender_id?: string;
          body?: string;
          read_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      newsletter_subscribers: {
        Row: {
          id: string;
          email: string;
          user_id: string | null;
          city: string | null;
          active: boolean | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          email: string;
          user_id?: string | null;
          city?: string | null;
          active?: boolean | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          email?: string;
          user_id?: string | null;
          city?: string | null;
          active?: boolean | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          body: string | null;
          link: string | null;
          is_read: boolean | null;
          created_at: string | null;
          pushed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          body?: string | null;
          link?: string | null;
          is_read?: boolean | null;
          created_at?: string | null;
          pushed_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          body?: string | null;
          link?: string | null;
          is_read?: boolean | null;
          created_at?: string | null;
          pushed_at?: string | null;
        };
        Relationships: [];
      };
      operational_alert_log: {
        Row: {
          alert_key: string;
          last_sent_at: string;
        };
        Insert: {
          alert_key: string;
          last_sent_at?: string;
        };
        Update: {
          alert_key?: string;
          last_sent_at?: string;
        };
        Relationships: [];
      };
      order_delivery_codes: {
        Row: {
          order_id: string;
          code: string;
          verified_at: string | null;
          created_at: string | null;
          attempts: number;
          locked_until: string | null;
        };
        Insert: {
          order_id: string;
          code: string;
          verified_at?: string | null;
          created_at?: string | null;
          attempts?: number;
          locked_until?: string | null;
        };
        Update: {
          order_id?: string;
          code?: string;
          verified_at?: string | null;
          created_at?: string | null;
          attempts?: number;
          locked_until?: string | null;
        };
        Relationships: [];
      };
      order_items: {
        Row: {
          id: string;
          order_id: string | null;
          product_id: string | null;
          quantity: number;
          unit_price: number;
          variant_id: string | null;
          variant_label: string | null;
        };
        Insert: {
          id?: string;
          order_id?: string | null;
          product_id?: string | null;
          quantity: number;
          unit_price: number;
          variant_id?: string | null;
          variant_label?: string | null;
        };
        Update: {
          id?: string;
          order_id?: string | null;
          product_id?: string | null;
          quantity?: number;
          unit_price?: number;
          variant_id?: string | null;
          variant_label?: string | null;
        };
        Relationships: [];
      };
      order_pickup_codes: {
        Row: {
          order_id: string;
          code: string;
          verified_at: string | null;
          created_at: string | null;
          attempts: number;
          locked_until: string | null;
        };
        Insert: {
          order_id: string;
          code: string;
          verified_at?: string | null;
          created_at?: string | null;
          attempts?: number;
          locked_until?: string | null;
        };
        Update: {
          order_id?: string;
          code?: string;
          verified_at?: string | null;
          created_at?: string | null;
          attempts?: number;
          locked_until?: string | null;
        };
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          user_id: string | null;
          total_price: number;
          payment_status: string | null;
          delivery_status: string | null;
          created_at: string | null;
          seller_id: string | null;
          coupon_code: string | null;
          pickup_in_store: boolean | null;
          stripe_session_id: string | null;
          stripe_transfer_group: string | null;
          stripe_reversal_id: string | null;
          dispute_status: string | null;
          disputed_at: string | null;
          rider_payout_status: string | null;
          refunded_amount_cents: number;
          wallet_applied_cents: number;
          delivery_fee_cents: number;
          delivery_slot: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          total_price: number;
          payment_status?: string | null;
          delivery_status?: string | null;
          created_at?: string | null;
          seller_id?: string | null;
          coupon_code?: string | null;
          pickup_in_store?: boolean | null;
          stripe_session_id?: string | null;
          stripe_transfer_group?: string | null;
          stripe_reversal_id?: string | null;
          dispute_status?: string | null;
          disputed_at?: string | null;
          rider_payout_status?: string | null;
          refunded_amount_cents?: number;
          wallet_applied_cents?: number;
          delivery_fee_cents?: number;
          delivery_slot?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          total_price?: number;
          payment_status?: string | null;
          delivery_status?: string | null;
          created_at?: string | null;
          seller_id?: string | null;
          coupon_code?: string | null;
          pickup_in_store?: boolean | null;
          stripe_session_id?: string | null;
          stripe_transfer_group?: string | null;
          stripe_reversal_id?: string | null;
          dispute_status?: string | null;
          disputed_at?: string | null;
          rider_payout_status?: string | null;
          refunded_amount_cents?: number;
          wallet_applied_cents?: number;
          delivery_fee_cents?: number;
          delivery_slot?: string | null;
        };
        Relationships: [];
      };
      pending_checkouts: {
        Row: {
          id: string;
          buyer_id: string;
          stripe_session_id: string | null;
          stripe_payment_intent: string | null;
          total_cents: number;
          currency: string;
          groups: Json;
          coupon_code: string | null;
          b2b: Json | null;
          delivery: Json;
          pickup_in_store: boolean;
          status: string;
          created_at: string;
          expires_at: string;
          processed_at: string | null;
        };
        Insert: {
          id?: string;
          buyer_id: string;
          stripe_session_id?: string | null;
          stripe_payment_intent?: string | null;
          total_cents: number;
          currency?: string;
          groups: Json;
          coupon_code?: string | null;
          b2b?: Json | null;
          delivery: Json;
          pickup_in_store?: boolean;
          status?: string;
          created_at?: string;
          expires_at?: string;
          processed_at?: string | null;
        };
        Update: {
          id?: string;
          buyer_id?: string;
          stripe_session_id?: string | null;
          stripe_payment_intent?: string | null;
          total_cents?: number;
          currency?: string;
          groups?: Json;
          coupon_code?: string | null;
          b2b?: Json | null;
          delivery?: Json;
          pickup_in_store?: boolean;
          status?: string;
          created_at?: string;
          expires_at?: string;
          processed_at?: string | null;
        };
        Relationships: [];
      };
      product_list_items: {
        Row: {
          list_id: string;
          product_id: string;
          sort_order: number;
          note: string | null;
          added_at: string;
        };
        Insert: {
          list_id: string;
          product_id: string;
          sort_order?: number;
          note?: string | null;
          added_at?: string;
        };
        Update: {
          list_id?: string;
          product_id?: string;
          sort_order?: number;
          note?: string | null;
          added_at?: string;
        };
        Relationships: [];
      };
      product_lists: {
        Row: {
          id: string;
          owner_id: string;
          title: string;
          description: string | null;
          cover_emoji: string | null;
          is_public: boolean;
          is_featured: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          title: string;
          description?: string | null;
          cover_emoji?: string | null;
          is_public?: boolean;
          is_featured?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          title?: string;
          description?: string | null;
          cover_emoji?: string | null;
          is_public?: boolean;
          is_featured?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      product_questions: {
        Row: {
          id: string;
          product_id: string;
          author_id: string;
          question: string;
          answer: string | null;
          answered_by: string | null;
          answered_at: string | null;
          is_public: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          author_id: string;
          question: string;
          answer?: string | null;
          answered_by?: string | null;
          answered_at?: string | null;
          is_public?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          product_id?: string;
          author_id?: string;
          question?: string;
          answer?: string | null;
          answered_by?: string | null;
          answered_at?: string | null;
          is_public?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      product_variants: {
        Row: {
          id: string;
          product_id: string;
          options: Json;
          label: string;
          stock: number;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          options?: Json;
          label?: string;
          stock?: number;
          position?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          product_id?: string;
          options?: Json;
          label?: string;
          stock?: number;
          position?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      product_views: {
        Row: {
          id: number;
          product_id: string;
          user_id: string | null;
          viewed_at: string;
        };
        Insert: {
          id: number;
          product_id: string;
          user_id?: string | null;
          viewed_at?: string;
        };
        Update: {
          id?: number;
          product_id?: string;
          user_id?: string | null;
          viewed_at?: string;
        };
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          price: number;
          images: Json | null;
          seller_id: string | null;
          status: string | null;
          created_at: string | null;
          category_id: string | null;
          attributes: Json | null;
          unit: string | null;
          has_variants: boolean;
          external_source_url: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          price: number;
          images?: Json | null;
          seller_id?: string | null;
          status?: string | null;
          created_at?: string | null;
          category_id?: string | null;
          attributes?: Json | null;
          unit?: string | null;
          has_variants?: boolean;
          external_source_url?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          price?: number;
          images?: Json | null;
          seller_id?: string | null;
          status?: string | null;
          created_at?: string | null;
          category_id?: string | null;
          attributes?: Json | null;
          unit?: string | null;
          has_variants?: boolean;
          external_source_url?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          role: string | null;
          is_approved: boolean | null;
          store_name: string | null;
          store_lat: number | null;
          store_lng: number | null;
          store_phone: string | null;
          created_at: string | null;
          full_name: string | null;
          store_address: string | null;
          store_logo: string | null;
          store_hours: Json | null;
          referral_code: string | null;
          store_media: Json | null;
          legal_first_name: string | null;
          business_legal_name: string | null;
          approval_status: string | null;
          tos_accepted_at: string | null;
          billing_iban: string | null;
          stripe_account_id: string | null;
          account_type: string | null;
          public_profile_enabled: boolean;
          deletion_requested_at: string | null;
          store_customization: Json;
          rider_is_online: boolean;
          notif_order_updates: boolean;
          offers_express: boolean;
          store_site: Json;
          wallet_balance_cents: number;
          stripe_customer_id: string | null;
          founded_year: number | null;
        };
        Insert: {
          id: string;
          role?: string | null;
          is_approved?: boolean | null;
          store_name?: string | null;
          store_lat?: number | null;
          store_lng?: number | null;
          store_phone?: string | null;
          created_at?: string | null;
          full_name?: string | null;
          store_address?: string | null;
          store_logo?: string | null;
          store_hours?: Json | null;
          referral_code?: string | null;
          store_media?: Json | null;
          legal_first_name?: string | null;
          business_legal_name?: string | null;
          approval_status?: string | null;
          tos_accepted_at?: string | null;
          billing_iban?: string | null;
          stripe_account_id?: string | null;
          account_type?: string | null;
          public_profile_enabled?: boolean;
          deletion_requested_at?: string | null;
          store_customization?: Json;
          rider_is_online?: boolean;
          notif_order_updates?: boolean;
          offers_express?: boolean;
          store_site?: Json;
          wallet_balance_cents?: number;
          stripe_customer_id?: string | null;
          founded_year?: number | null;
        };
        Update: {
          id?: string;
          role?: string | null;
          is_approved?: boolean | null;
          store_name?: string | null;
          store_lat?: number | null;
          store_lng?: number | null;
          store_phone?: string | null;
          created_at?: string | null;
          full_name?: string | null;
          store_address?: string | null;
          store_logo?: string | null;
          store_hours?: Json | null;
          referral_code?: string | null;
          store_media?: Json | null;
          legal_first_name?: string | null;
          business_legal_name?: string | null;
          approval_status?: string | null;
          tos_accepted_at?: string | null;
          billing_iban?: string | null;
          stripe_account_id?: string | null;
          account_type?: string | null;
          public_profile_enabled?: boolean;
          deletion_requested_at?: string | null;
          store_customization?: Json;
          rider_is_online?: boolean;
          notif_order_updates?: boolean;
          offers_express?: boolean;
          store_site?: Json;
          wallet_balance_cents?: number;
          stripe_customer_id?: string | null;
          founded_year?: number | null;
        };
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          endpoint?: string;
          p256dh?: string;
          auth?: string;
          user_agent?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      recently_viewed: {
        Row: {
          user_id: string;
          product_id: string;
          viewed_at: string;
        };
        Insert: {
          user_id: string;
          product_id: string;
          viewed_at?: string;
        };
        Update: {
          user_id?: string;
          product_id?: string;
          viewed_at?: string;
        };
        Relationships: [];
      };
      referrals: {
        Row: {
          id: string;
          referrer_id: string;
          referred_id: string;
          reward_amount: number;
          rewarded: boolean | null;
          rewarded_at: string | null;
          created_at: string | null;
          code: string | null;
        };
        Insert: {
          id?: string;
          referrer_id: string;
          referred_id: string;
          reward_amount?: number;
          rewarded?: boolean | null;
          rewarded_at?: string | null;
          created_at?: string | null;
          code?: string | null;
        };
        Update: {
          id?: string;
          referrer_id?: string;
          referred_id?: string;
          reward_amount?: number;
          rewarded?: boolean | null;
          rewarded_at?: string | null;
          created_at?: string | null;
          code?: string | null;
        };
        Relationships: [];
      };
      returns: {
        Row: {
          id: string;
          order_id: string;
          order_item_id: string | null;
          buyer_id: string;
          seller_id: string;
          reason: string;
          notes: string | null;
          photo_urls: Json | null;
          status: string;
          refund_amount_cents: number | null;
          refund_id: string | null;
          return_label_url: string | null;
          tracking_number: string | null;
          created_at: string | null;
          decided_at: string | null;
          decided_by: string | null;
          refunded_at: string | null;
          decision_notes: string | null;
        };
        Insert: {
          id?: string;
          order_id: string;
          order_item_id?: string | null;
          buyer_id: string;
          seller_id: string;
          reason: string;
          notes?: string | null;
          photo_urls?: Json | null;
          status?: string;
          refund_amount_cents?: number | null;
          refund_id?: string | null;
          return_label_url?: string | null;
          tracking_number?: string | null;
          created_at?: string | null;
          decided_at?: string | null;
          decided_by?: string | null;
          refunded_at?: string | null;
          decision_notes?: string | null;
        };
        Update: {
          id?: string;
          order_id?: string;
          order_item_id?: string | null;
          buyer_id?: string;
          seller_id?: string;
          reason?: string;
          notes?: string | null;
          photo_urls?: Json | null;
          status?: string;
          refund_amount_cents?: number | null;
          refund_id?: string | null;
          return_label_url?: string | null;
          tracking_number?: string | null;
          created_at?: string | null;
          decided_at?: string | null;
          decided_by?: string | null;
          refunded_at?: string | null;
          decision_notes?: string | null;
        };
        Relationships: [];
      };
      review_helpful: {
        Row: {
          review_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          review_id: string;
          user_id: string;
          created_at?: string;
        };
        Update: {
          review_id?: string;
          user_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      reviews: {
        Row: {
          id: string;
          product_id: string | null;
          user_id: string | null;
          rating: number;
          comment: string | null;
          created_at: string | null;
          photo_urls: string | null;
        };
        Insert: {
          id?: string;
          product_id?: string | null;
          user_id?: string | null;
          rating: number;
          comment?: string | null;
          created_at?: string | null;
          photo_urls?: string | null;
        };
        Update: {
          id?: string;
          product_id?: string | null;
          user_id?: string | null;
          rating?: number;
          comment?: string | null;
          created_at?: string | null;
          photo_urls?: string | null;
        };
        Relationships: [];
      };
      rider_reviews: {
        Row: {
          id: string;
          rider_id: string;
          user_id: string;
          order_id: string;
          rating: number;
          comment: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          rider_id: string;
          user_id: string;
          order_id: string;
          rating: number;
          comment?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          rider_id?: string;
          user_id?: string;
          order_id?: string;
          rating?: number;
          comment?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      rider_sos_events: {
        Row: {
          id: string;
          rider_id: string;
          order_id: string | null;
          lat: number | null;
          lng: number | null;
          triggered_at: string;
          resolved_at: string | null;
          resolution_note: string | null;
          handled_by: string | null;
        };
        Insert: {
          id?: string;
          rider_id: string;
          order_id?: string | null;
          lat?: number | null;
          lng?: number | null;
          triggered_at?: string;
          resolved_at?: string | null;
          resolution_note?: string | null;
          handled_by?: string | null;
        };
        Update: {
          id?: string;
          rider_id?: string;
          order_id?: string | null;
          lat?: number | null;
          lng?: number | null;
          triggered_at?: string;
          resolved_at?: string | null;
          resolution_note?: string | null;
          handled_by?: string | null;
        };
        Relationships: [];
      };
      seller_promotions: {
        Row: {
          id: string;
          seller_id: string;
          title: string;
          discount_percent: number;
          scope: string;
          category_id: string | null;
          product_ids: string | null;
          starts_at: string;
          ends_at: string;
          status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          seller_id: string;
          title: string;
          discount_percent: number;
          scope: string;
          category_id?: string | null;
          product_ids?: string | null;
          starts_at?: string;
          ends_at: string;
          status?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          seller_id?: string;
          title?: string;
          discount_percent?: number;
          scope?: string;
          category_id?: string | null;
          product_ids?: string | null;
          starts_at?: string;
          ends_at?: string;
          status?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      seller_stories: {
        Row: {
          id: string;
          seller_id: string;
          image_url: string;
          caption: string | null;
          link_url: string | null;
          expires_at: string;
          view_count: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          seller_id: string;
          image_url: string;
          caption?: string | null;
          link_url?: string | null;
          expires_at?: string;
          view_count?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          seller_id?: string;
          image_url?: string;
          caption?: string | null;
          link_url?: string | null;
          expires_at?: string;
          view_count?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      seller_story_views: {
        Row: {
          story_id: string;
          user_id: string;
          viewed_at: string;
        };
        Insert: {
          story_id: string;
          user_id: string;
          viewed_at?: string;
        };
        Update: {
          story_id?: string;
          user_id?: string;
          viewed_at?: string;
        };
        Relationships: [];
      };
      shop_of_month: {
        Row: {
          id: string;
          seller_id: string;
          month: string;
          cover_image_url: string | null;
          headline: string | null;
          story: string | null;
          discount_code: string | null;
          discount_percent: number | null;
          selected_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          seller_id: string;
          month: string;
          cover_image_url?: string | null;
          headline?: string | null;
          story?: string | null;
          discount_code?: string | null;
          discount_percent?: number | null;
          selected_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          seller_id?: string;
          month?: string;
          cover_image_url?: string | null;
          headline?: string | null;
          story?: string | null;
          discount_code?: string | null;
          discount_percent?: number | null;
          selected_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      shop_of_month_votes: {
        Row: {
          id: string;
          voter_id: string;
          seller_id: string;
          month: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          voter_id: string;
          seller_id: string;
          month: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          voter_id?: string;
          seller_id?: string;
          month?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      site_settings: {
        Row: {
          id: number;
          home_site: Json;
          branding: Json;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          id?: number;
          home_site?: Json;
          branding?: Json;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          id?: number;
          home_site?: Json;
          branding?: Json;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      sponsored_listings: {
        Row: {
          id: string;
          product_id: string | null;
          seller_id: string;
          placement: string;
          category_slug: string | null;
          start_date: string;
          end_date: string;
          daily_budget_cents: number;
          spent_cents: number;
          impressions: number;
          clicks: number;
          status: string;
          created_at: string;
          stripe_session_id: string | null;
        };
        Insert: {
          id?: string;
          product_id?: string | null;
          seller_id: string;
          placement: string;
          category_slug?: string | null;
          start_date: string;
          end_date: string;
          daily_budget_cents?: number;
          spent_cents?: number;
          impressions?: number;
          clicks?: number;
          status?: string;
          created_at?: string;
          stripe_session_id?: string | null;
        };
        Update: {
          id?: string;
          product_id?: string | null;
          seller_id?: string;
          placement?: string;
          category_slug?: string | null;
          start_date?: string;
          end_date?: string;
          daily_budget_cents?: number;
          spent_cents?: number;
          impressions?: number;
          clicks?: number;
          status?: string;
          created_at?: string;
          stripe_session_id?: string | null;
        };
        Relationships: [];
      };
      store_reviews: {
        Row: {
          id: string;
          store_id: string;
          user_id: string;
          order_id: string;
          rating: number;
          comment: string | null;
          created_at: string | null;
          seller_reply: string | null;
          seller_reply_at: string | null;
          photo_urls: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          user_id: string;
          order_id: string;
          rating: number;
          comment?: string | null;
          created_at?: string | null;
          seller_reply?: string | null;
          seller_reply_at?: string | null;
          photo_urls?: string;
        };
        Update: {
          id?: string;
          store_id?: string;
          user_id?: string;
          order_id?: string;
          rating?: number;
          comment?: string | null;
          created_at?: string | null;
          seller_reply?: string | null;
          seller_reply_at?: string | null;
          photo_urls?: string;
        };
        Relationships: [];
      };
      stripe_event_log: {
        Row: {
          event_id: string;
          type: string;
          processed_at: string | null;
          processed: boolean;
        };
        Insert: {
          event_id: string;
          type: string;
          processed_at?: string | null;
          processed?: boolean;
        };
        Update: {
          event_id?: string;
          type?: string;
          processed_at?: string | null;
          processed?: boolean;
        };
        Relationships: [];
      };
      subscription_orders: {
        Row: {
          id: string;
          user_id: string;
          seller_id: string;
          items: Json;
          total_cents: number;
          frequency: string;
          weekday: number | null;
          delivery_time: string | null;
          delivery_address: Json | null;
          payment_method: string;
          status: string;
          next_delivery_at: string | null;
          last_delivery_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          seller_id: string;
          items: Json;
          total_cents: number;
          frequency: string;
          weekday?: number | null;
          delivery_time?: string | null;
          delivery_address?: Json | null;
          payment_method?: string;
          status?: string;
          next_delivery_at?: string | null;
          last_delivery_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          seller_id?: string;
          items?: Json;
          total_cents?: number;
          frequency?: string;
          weekday?: number | null;
          delivery_time?: string | null;
          delivery_address?: Json | null;
          payment_method?: string;
          status?: string;
          next_delivery_at?: string | null;
          last_delivery_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      user_achievements: {
        Row: {
          user_id: string;
          achievement_id: string;
          unlocked_at: string;
        };
        Insert: {
          user_id: string;
          achievement_id: string;
          unlocked_at?: string;
        };
        Update: {
          user_id?: string;
          achievement_id?: string;
          unlocked_at?: string;
        };
        Relationships: [];
      };
      user_addresses: {
        Row: {
          id: string;
          user_id: string;
          label: string;
          full_name: string;
          phone: string;
          address: string;
          city: string;
          zip: string;
          notes: string | null;
          lat: number | null;
          lng: number | null;
          is_default: boolean | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          label: string;
          full_name: string;
          phone: string;
          address: string;
          city: string;
          zip: string;
          notes?: string | null;
          lat?: number | null;
          lng?: number | null;
          is_default?: boolean | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          label?: string;
          full_name?: string;
          phone?: string;
          address?: string;
          city?: string;
          zip?: string;
          notes?: string | null;
          lat?: number | null;
          lng?: number | null;
          is_default?: boolean | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      user_carts: {
        Row: {
          user_id: string;
          items: Json;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          items?: Json;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          items?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      wallet_ledger: {
        Row: {
          id: string;
          user_id: string;
          delta_cents: number;
          reason: string;
          ref: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          delta_cents: number;
          reason: string;
          ref?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          delta_cents?: number;
          reason?: string;
          ref?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      zone_code_uses: {
        Row: {
          id: string;
          code: string;
          user_id: string;
          order_id: string | null;
          used_at: string;
        };
        Insert: {
          id?: string;
          code: string;
          user_id: string;
          order_id?: string | null;
          used_at?: string;
        };
        Update: {
          id?: string;
          code?: string;
          user_id?: string;
          order_id?: string | null;
          used_at?: string;
        };
        Relationships: [];
      };
      zone_codes: {
        Row: {
          id: string;
          code: string;
          zone_name: string;
          zip: string;
          city: string;
          discount_percent: number;
          min_order_cents: number;
          max_uses_per_user: number;
          expires_at: string | null;
          status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          code: string;
          zone_name: string;
          zip: string;
          city?: string;
          discount_percent: number;
          min_order_cents?: number;
          max_uses_per_user?: number;
          expires_at?: string | null;
          status?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          code?: string;
          zone_name?: string;
          zip?: string;
          city?: string;
          discount_percent?: number;
          min_order_cents?: number;
          max_uses_per_user?: number;
          expires_at?: string | null;
          status?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: { [key: string]: never };
    Functions: { [key: string]: never };
    Enums: { [key: string]: never };
    CompositeTypes: { [key: string]: never };
  };
}
