// AUTO-GENERATO da `supabase gen types typescript` sullo schema del DB LIVE.
// NON modificare a mano. Rigenerare dal DB live dopo ogni modifica di schema.
// Generato il 2026-05-29 — fonte: schema live (public), NON migrations/*.sql.
// NB: `npm run db:types` (scripts/gen-db-types.mjs) rigenera invece DALLE
// migrations e puo' reintrodurre drift finche' migrations e DB live non sono
// riconciliati (vedi audit schema).

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      abandoned_carts: {
        Row: {
          cart_data: Json
          cart_total: number
          last_activity: string
          recovered: boolean
          recovery_email_sent_at: string | null
          user_id: string
        }
        Insert: {
          cart_data: Json
          cart_total?: number
          last_activity?: string
          recovered?: boolean
          recovery_email_sent_at?: string | null
          user_id: string
        }
        Update: {
          cart_data?: Json
          cart_total?: number
          last_activity?: string
          recovered?: boolean
          recovery_email_sent_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "abandoned_carts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abandoned_carts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "abandoned_carts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      achievements: {
        Row: {
          description: string
          icon: string
          id: string
          points_reward: number
          sort_order: number
          target_role: string | null
          tier: string
          title: string
        }
        Insert: {
          description: string
          icon: string
          id: string
          points_reward?: number
          sort_order?: number
          target_role?: string | null
          tier?: string
          title: string
        }
        Update: {
          description?: string
          icon?: string
          id?: string
          points_reward?: number
          sort_order?: number
          target_role?: string | null
          tier?: string
          title?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          ip: string | null
          metadata: Json | null
          target_id: string | null
          target_table: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          ip?: string | null
          metadata?: Json | null
          target_id?: string | null
          target_table?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          ip?: string | null
          metadata?: Json | null
          target_id?: string | null
          target_table?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      business_orders: {
        Row: {
          company_name: string
          created_at: string
          id: string
          invoice_required: boolean
          order_id: string
          pec: string | null
          sdi_code: string | null
          vat_number: string
        }
        Insert: {
          company_name: string
          created_at?: string
          id?: string
          invoice_required?: boolean
          order_id: string
          pec?: string | null
          sdi_code?: string | null
          vat_number: string
        }
        Update: {
          company_name?: string
          created_at?: string
          id?: string
          invoice_required?: boolean
          order_id?: string
          pec?: string | null
          sdi_code?: string | null
          vat_number?: string
        }
        Relationships: []
      }
      cashback_campaigns: {
        Row: {
          bonus_points: number
          created_at: string
          description: string | null
          ends_at: string
          id: string
          min_order_cents: number
          name: string
          starts_at: string
          status: string
          target_category_id: string | null
          trigger_event: string
          valid_hours: number
        }
        Insert: {
          bonus_points?: number
          created_at?: string
          description?: string | null
          ends_at?: string
          id?: string
          min_order_cents?: number
          name: string
          starts_at?: string
          status?: string
          target_category_id?: string | null
          trigger_event: string
          valid_hours?: number
        }
        Update: {
          bonus_points?: number
          created_at?: string
          description?: string | null
          ends_at?: string
          id?: string
          min_order_cents?: number
          name?: string
          starts_at?: string
          status?: string
          target_category_id?: string | null
          trigger_event?: string
          valid_hours?: number
        }
        Relationships: [
          {
            foreignKeyName: "cashback_campaigns_target_category_id_fkey"
            columns: ["target_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      cashback_redemptions: {
        Row: {
          awarded_at: string
          campaign_id: string
          order_id: string | null
          points_awarded: number
          user_id: string
        }
        Insert: {
          awarded_at?: string
          campaign_id: string
          order_id?: string | null
          points_awarded: number
          user_id: string
        }
        Update: {
          awarded_at?: string
          campaign_id?: string
          order_id?: string | null
          points_awarded?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cashback_redemptions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "cashback_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashback_redemptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashback_redemptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashback_redemptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "cashback_redemptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string | null
          icon: string | null
          id: string
          name: string
          parent_id: string | null
          slug: string
        }
        Insert: {
          created_at?: string | null
          icon?: string | null
          id?: string
          name: string
          parent_id?: string | null
          slug: string
        }
        Update: {
          created_at?: string | null
          icon?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      cod_reconciliations: {
        Row: {
          collected_cents: number
          created_at: string | null
          delta_cents: number | null
          expected_cents: number
          for_date: string
          id: string
          notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          rider_id: string
          status: string
        }
        Insert: {
          collected_cents?: number
          created_at?: string | null
          delta_cents?: number | null
          expected_cents?: number
          for_date: string
          id?: string
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rider_id: string
          status?: string
        }
        Update: {
          collected_cents?: number
          created_at?: string | null
          delta_cents?: number | null
          expected_cents?: number
          for_date?: string
          id?: string
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rider_id?: string
          status?: string
        }
        Relationships: []
      }
      contact_messages: {
        Row: {
          admin_notes: string | null
          created_at: string
          email: string
          handled_at: string | null
          handled_by: string | null
          id: string
          ip: string | null
          message: string
          name: string
          status: string
          subject: string
          user_id: string | null
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          email: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          ip?: string | null
          message: string
          name: string
          status?: string
          subject?: string
          user_id?: string | null
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          email?: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          ip?: string | null
          message?: string
          name?: string
          status?: string
          subject?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_messages_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_messages_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "contact_messages_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "contact_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "contact_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      conversations: {
        Row: {
          buyer_id: string
          buyer_unread_count: number
          created_at: string
          id: string
          last_message_at: string
          last_message_preview: string | null
          seller_id: string
          seller_unread_count: number
        }
        Insert: {
          buyer_id: string
          buyer_unread_count?: number
          created_at?: string
          id?: string
          last_message_at?: string
          last_message_preview?: string | null
          seller_id: string
          seller_unread_count?: number
        }
        Update: {
          buyer_id?: string
          buyer_unread_count?: number
          created_at?: string
          id?: string
          last_message_at?: string
          last_message_preview?: string | null
          seller_id?: string
          seller_unread_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversations_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "conversations_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "conversations_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "conversations_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      coupons: {
        Row: {
          active: boolean | null
          code: string
          created_at: string | null
          description: string | null
          expires_at: string | null
          first_order_only: boolean | null
          id: string
          max_uses: number | null
          min_subtotal: number | null
          type: string
          uses_count: number | null
          value: number
        }
        Insert: {
          active?: boolean | null
          code: string
          created_at?: string | null
          description?: string | null
          expires_at?: string | null
          first_order_only?: boolean | null
          id?: string
          max_uses?: number | null
          min_subtotal?: number | null
          type: string
          uses_count?: number | null
          value?: number
        }
        Update: {
          active?: boolean | null
          code?: string
          created_at?: string | null
          description?: string | null
          expires_at?: string | null
          first_order_only?: boolean | null
          id?: string
          max_uses?: number | null
          min_subtotal?: number | null
          type?: string
          uses_count?: number | null
          value?: number
        }
        Relationships: []
      }
      daily_drops: {
        Row: {
          created_at: string
          discount_percent: number
          drop_date: string
          drop_price: number
          headline: string | null
          id: string
          original_price: number
          product_id: string
        }
        Insert: {
          created_at?: string
          discount_percent: number
          drop_date: string
          drop_price: number
          headline?: string | null
          id?: string
          original_price: number
          product_id: string
        }
        Update: {
          created_at?: string
          discount_percent?: number
          drop_date?: string
          drop_price?: number
          headline?: string | null
          id?: string
          original_price?: number
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_drops_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_stories: {
        Row: {
          body: string
          created_at: string
          cta_label: string | null
          cta_url: string | null
          feature_date: string
          id: string
          image_url: string | null
          seller_id: string
          title: string
        }
        Insert: {
          body: string
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          feature_date: string
          id?: string
          image_url?: string | null
          seller_id: string
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          feature_date?: string
          id?: string
          image_url?: string | null
          seller_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_stories_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_stories_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "daily_stories_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      disputes: {
        Row: {
          against_id: string | null
          created_at: string
          description: string
          id: string
          opener_id: string
          order_id: string
          reason: string
          refund_cents: number | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          against_id?: string | null
          created_at?: string
          description: string
          id?: string
          opener_id: string
          order_id: string
          reason: string
          refund_cents?: number | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          against_id?: string | null
          created_at?: string
          description?: string
          id?: string
          opener_id?: string
          order_id?: string
          reason?: string
          refund_cents?: number | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "disputes_against_id_fkey"
            columns: ["against_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_against_id_fkey"
            columns: ["against_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "disputes_against_id_fkey"
            columns: ["against_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "disputes_opener_id_fkey"
            columns: ["opener_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_opener_id_fkey"
            columns: ["opener_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "disputes_opener_id_fkey"
            columns: ["opener_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "disputes_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "disputes_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      email_queue: {
        Row: {
          cancelled_at: string | null
          created_at: string
          id: string
          metadata: Json | null
          send_at: string
          sent_at: string | null
          template: string
          user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          send_at: string
          sent_at?: string | null
          template: string
          user_id: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          send_at?: string
          sent_at?: string | null
          template?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "email_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      event_rsvps: {
        Row: {
          created_at: string
          event_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_rsvps_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "marketplace_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_rsvps_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_rsvps_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "event_rsvps_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      favorites: {
        Row: {
          created_at: string | null
          product_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          product_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          product_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      gift_cards: {
        Row: {
          amount_cents: number
          balance_cents: number
          buyer_id: string | null
          code: string
          created_at: string
          expires_at: string
          message: string | null
          recipient_email: string | null
          recipient_name: string | null
          redeemed_at: string | null
          redeemed_by: string | null
        }
        Insert: {
          amount_cents: number
          balance_cents: number
          buyer_id?: string | null
          code: string
          created_at?: string
          expires_at?: string
          message?: string | null
          recipient_email?: string | null
          recipient_name?: string | null
          redeemed_at?: string | null
          redeemed_by?: string | null
        }
        Update: {
          amount_cents?: number
          balance_cents?: number
          buyer_id?: string | null
          code?: string
          created_at?: string
          expires_at?: string
          message?: string | null
          recipient_email?: string | null
          recipient_name?: string | null
          redeemed_at?: string | null
          redeemed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gift_cards_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_cards_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "gift_cards_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "gift_cards_redeemed_by_fkey"
            columns: ["redeemed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_cards_redeemed_by_fkey"
            columns: ["redeemed_by"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "gift_cards_redeemed_by_fkey"
            columns: ["redeemed_by"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      group_orders: {
        Row: {
          created_at: string | null
          current_quantity: number
          deadline: string
          discount_percent: number
          discounted_price: number
          id: string
          organizer_id: string
          product_id: string
          seller_id: string
          status: string
          target_quantity: number
          title: string | null
          unit_price: number
        }
        Insert: {
          created_at?: string | null
          current_quantity?: number
          deadline: string
          discount_percent: number
          discounted_price: number
          id?: string
          organizer_id: string
          product_id: string
          seller_id: string
          status?: string
          target_quantity: number
          title?: string | null
          unit_price: number
        }
        Update: {
          created_at?: string | null
          current_quantity?: number
          deadline?: string
          discount_percent?: number
          discounted_price?: number
          id?: string
          organizer_id?: string
          product_id?: string
          seller_id?: string
          status?: string
          target_quantity?: number
          title?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "group_orders_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_orders_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "group_orders_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "group_orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_orders_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_orders_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "group_orders_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      group_participants: {
        Row: {
          group_order_id: string
          id: string
          joined_at: string | null
          quantity: number
          user_id: string
        }
        Insert: {
          group_order_id: string
          id?: string
          joined_at?: string | null
          quantity?: number
          user_id: string
        }
        Update: {
          group_order_id?: string
          id?: string
          joined_at?: string | null
          quantity?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_participants_group_order_id_fkey"
            columns: ["group_order_id"]
            isOneToOne: false
            referencedRelation: "group_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "group_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      invoice_sequences: {
        Row: {
          last_number: number
          seller_id: string
          updated_at: string | null
          year: number
        }
        Insert: {
          last_number?: number
          seller_id: string
          updated_at?: string | null
          year: number
        }
        Update: {
          last_number?: number
          seller_id?: string
          updated_at?: string | null
          year?: number
        }
        Relationships: []
      }
      kpi_snapshots: {
        Row: {
          active_merchants: number
          cart_abandon_rate: number | null
          computed_at: string
          conversion_rate: number | null
          gmv_cents: number
          new_customers: number
          new_merchants: number
          orders_count: number
          raw: Json | null
          snapshot_date: string
          uptime_pct: number | null
        }
        Insert: {
          active_merchants?: number
          cart_abandon_rate?: number | null
          computed_at?: string
          conversion_rate?: number | null
          gmv_cents?: number
          new_customers?: number
          new_merchants?: number
          orders_count?: number
          raw?: Json | null
          snapshot_date: string
          uptime_pct?: number | null
        }
        Update: {
          active_merchants?: number
          cart_abandon_rate?: number | null
          computed_at?: string
          conversion_rate?: number | null
          gmv_cents?: number
          new_customers?: number
          new_merchants?: number
          orders_count?: number
          raw?: Json | null
          snapshot_date?: string
          uptime_pct?: number | null
        }
        Relationships: []
      }
      loyalty_accounts: {
        Row: {
          created_at: string
          last_visit_date: string | null
          lifetime_earned: number
          longest_streak: number
          points_balance: number
          streak_days: number
          tier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          last_visit_date?: string | null
          lifetime_earned?: number
          longest_streak?: number
          points_balance?: number
          streak_days?: number
          tier?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          last_visit_date?: string | null
          lifetime_earned?: number
          longest_streak?: number
          points_balance?: number
          streak_days?: number
          tier?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "loyalty_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      loyalty_transactions: {
        Row: {
          created_at: string
          delta: number
          id: string
          metadata: Json | null
          order_id: string | null
          reason: string
          user_id: string
        }
        Insert: {
          created_at?: string
          delta: number
          id?: string
          metadata?: Json | null
          order_id?: string | null
          reason: string
          user_id: string
        }
        Update: {
          created_at?: string
          delta?: number
          id?: string
          metadata?: Json | null
          order_id?: string | null
          reason?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "loyalty_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      marketplace_events: {
        Row: {
          cover_image_url: string | null
          created_at: string
          cta_label: string | null
          cta_url: string | null
          description: string
          discount_percent: number | null
          ends_at: string
          id: string
          sponsor_seller_id: string | null
          starts_at: string
          status: string
          title: string
        }
        Insert: {
          cover_image_url?: string | null
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          description: string
          discount_percent?: number | null
          ends_at: string
          id?: string
          sponsor_seller_id?: string | null
          starts_at: string
          status?: string
          title: string
        }
        Update: {
          cover_image_url?: string | null
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          description?: string
          discount_percent?: number | null
          ends_at?: string
          id?: string
          sponsor_seller_id?: string | null
          starts_at?: string
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_events_sponsor_seller_id_fkey"
            columns: ["sponsor_seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_events_sponsor_seller_id_fkey"
            columns: ["sponsor_seller_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "marketplace_events_sponsor_seller_id_fkey"
            columns: ["sponsor_seller_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      merchants_leads: {
        Row: {
          address: string | null
          category: string | null
          created_at: string
          email: string | null
          google_place_id: string | null
          id: string
          lat: number | null
          lng: number | null
          name: string
          notes: string | null
          outreach_status: string
          phone: string | null
          rating: number | null
          reviews_count: number | null
          score: number | null
          source: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          category?: string | null
          created_at?: string
          email?: string | null
          google_place_id?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          name: string
          notes?: string | null
          outreach_status?: string
          phone?: string | null
          rating?: number | null
          reviews_count?: number | null
          score?: number | null
          source?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          category?: string | null
          created_at?: string
          email?: string | null
          google_place_id?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          name?: string
          notes?: string | null
          outreach_status?: string
          phone?: string | null
          rating?: number | null
          reviews_count?: number | null
          score?: number | null
          source?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          id: string
          read_at: string | null
          sender_id: string
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id: string
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      newsletter_subscribers: {
        Row: {
          active: boolean | null
          city: string | null
          created_at: string | null
          email: string
          id: string
          user_id: string | null
        }
        Insert: {
          active?: boolean | null
          city?: string | null
          created_at?: string | null
          email: string
          id?: string
          user_id?: string | null
        }
        Update: {
          active?: boolean | null
          city?: string | null
          created_at?: string | null
          email?: string
          id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "newsletter_subscribers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "newsletter_subscribers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "newsletter_subscribers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string | null
          id: string
          is_read: boolean | null
          link: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          link?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          link?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      order_delivery_codes: {
        Row: {
          code: string
          created_at: string | null
          order_id: string
          verified_at: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          order_id: string
          verified_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          order_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_delivery_codes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          id: string
          order_id: string | null
          product_id: string | null
          quantity: number
          unit_price: number
        }
        Insert: {
          id?: string
          order_id?: string | null
          product_id?: string | null
          quantity: number
          unit_price: number
        }
        Update: {
          id?: string
          order_id?: string | null
          product_id?: string | null
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      order_pickup_codes: {
        Row: {
          code: string
          created_at: string | null
          order_id: string
          verified_at: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          order_id: string
          verified_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          order_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_pickup_codes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          accepted_at: string | null
          application_fee_cents: number | null
          canceled_at: string | null
          cash_collected_by: string | null
          cash_collected_cents: number | null
          cash_confirmed_at: string | null
          cash_photo_url: string | null
          cash_signature_url: string | null
          coupon_code: string | null
          created_at: string | null
          delivered_at: string | null
          delivery_address: string | null
          delivery_city: string | null
          delivery_full_name: string | null
          delivery_lat: number | null
          delivery_lng: number | null
          delivery_notes: string | null
          delivery_phone: string | null
          delivery_photo_url: string | null
          delivery_signature_url: string | null
          delivery_status: string | null
          delivery_zip: string | null
          discount_amount: number | null
          dispute_status: string | null
          disputed_at: string | null
          id: string
          invoice_issued_at: string | null
          invoice_number: string | null
          invoice_pdf_url: string | null
          invoice_sdi_id: string | null
          invoice_sdi_status: string | null
          payment_method: string | null
          payment_status: string | null
          payout_at: string | null
          payout_status: string | null
          picked_up_at: string | null
          pickup_in_store: boolean | null
          ready_at: string | null
          rider_id: string | null
          rider_lat: number | null
          rider_lng: number | null
          rider_payout_at: string | null
          rider_payout_status: string | null
          rider_position_updated_at: string | null
          rider_transfer_id: string | null
          seller_id: string | null
          seller_payout_cents: number | null
          shipping_cost: number
          stripe_charge_id: string | null
          stripe_payment_intent: string | null
          stripe_refund_id: string | null
          stripe_reversal_id: string | null
          stripe_session_id: string | null
          stripe_transfer_group: string | null
          stripe_transfer_id: string | null
          total_price: number
          user_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          application_fee_cents?: number | null
          canceled_at?: string | null
          cash_collected_by?: string | null
          cash_collected_cents?: number | null
          cash_confirmed_at?: string | null
          cash_photo_url?: string | null
          cash_signature_url?: string | null
          coupon_code?: string | null
          created_at?: string | null
          delivered_at?: string | null
          delivery_address?: string | null
          delivery_city?: string | null
          delivery_full_name?: string | null
          delivery_lat?: number | null
          delivery_lng?: number | null
          delivery_notes?: string | null
          delivery_phone?: string | null
          delivery_photo_url?: string | null
          delivery_signature_url?: string | null
          delivery_status?: string | null
          delivery_zip?: string | null
          discount_amount?: number | null
          dispute_status?: string | null
          disputed_at?: string | null
          id?: string
          invoice_issued_at?: string | null
          invoice_number?: string | null
          invoice_pdf_url?: string | null
          invoice_sdi_id?: string | null
          invoice_sdi_status?: string | null
          payment_method?: string | null
          payment_status?: string | null
          payout_at?: string | null
          payout_status?: string | null
          picked_up_at?: string | null
          pickup_in_store?: boolean | null
          ready_at?: string | null
          rider_id?: string | null
          rider_lat?: number | null
          rider_lng?: number | null
          rider_payout_at?: string | null
          rider_payout_status?: string | null
          rider_position_updated_at?: string | null
          rider_transfer_id?: string | null
          seller_id?: string | null
          seller_payout_cents?: number | null
          shipping_cost?: number
          stripe_charge_id?: string | null
          stripe_payment_intent?: string | null
          stripe_refund_id?: string | null
          stripe_reversal_id?: string | null
          stripe_session_id?: string | null
          stripe_transfer_group?: string | null
          stripe_transfer_id?: string | null
          total_price: number
          user_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          application_fee_cents?: number | null
          canceled_at?: string | null
          cash_collected_by?: string | null
          cash_collected_cents?: number | null
          cash_confirmed_at?: string | null
          cash_photo_url?: string | null
          cash_signature_url?: string | null
          coupon_code?: string | null
          created_at?: string | null
          delivered_at?: string | null
          delivery_address?: string | null
          delivery_city?: string | null
          delivery_full_name?: string | null
          delivery_lat?: number | null
          delivery_lng?: number | null
          delivery_notes?: string | null
          delivery_phone?: string | null
          delivery_photo_url?: string | null
          delivery_signature_url?: string | null
          delivery_status?: string | null
          delivery_zip?: string | null
          discount_amount?: number | null
          dispute_status?: string | null
          disputed_at?: string | null
          id?: string
          invoice_issued_at?: string | null
          invoice_number?: string | null
          invoice_pdf_url?: string | null
          invoice_sdi_id?: string | null
          invoice_sdi_status?: string | null
          payment_method?: string | null
          payment_status?: string | null
          payout_at?: string | null
          payout_status?: string | null
          picked_up_at?: string | null
          pickup_in_store?: boolean | null
          ready_at?: string | null
          rider_id?: string | null
          rider_lat?: number | null
          rider_lng?: number | null
          rider_payout_at?: string | null
          rider_payout_status?: string | null
          rider_position_updated_at?: string | null
          rider_transfer_id?: string | null
          seller_id?: string | null
          seller_payout_cents?: number | null
          shipping_cost?: number
          stripe_charge_id?: string | null
          stripe_payment_intent?: string | null
          stripe_refund_id?: string | null
          stripe_reversal_id?: string | null
          stripe_session_id?: string | null
          stripe_transfer_group?: string | null
          stripe_transfer_id?: string | null
          total_price?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "orders_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "orders_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "orders_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      outreach_events: {
        Row: {
          bounced: boolean | null
          channel: string
          clicked_at: string | null
          created_at: string
          id: string
          lead_id: string
          opened_at: string | null
          provider_message_id: string | null
          replied_at: string | null
          sent_at: string
          sequence_step: number
          template_key: string | null
        }
        Insert: {
          bounced?: boolean | null
          channel?: string
          clicked_at?: string | null
          created_at?: string
          id?: string
          lead_id: string
          opened_at?: string | null
          provider_message_id?: string | null
          replied_at?: string | null
          sent_at?: string
          sequence_step: number
          template_key?: string | null
        }
        Update: {
          bounced?: boolean | null
          channel?: string
          clicked_at?: string | null
          created_at?: string
          id?: string
          lead_id?: string
          opened_at?: string | null
          provider_message_id?: string | null
          replied_at?: string | null
          sent_at?: string
          sequence_step?: number
          template_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outreach_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "merchants_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_checkouts: {
        Row: {
          b2b: Json | null
          buyer_id: string
          coupon_code: string | null
          created_at: string
          currency: string
          delivery: Json
          expires_at: string
          groups: Json
          id: string
          pickup_in_store: boolean
          processed_at: string | null
          status: string
          stripe_payment_intent: string | null
          stripe_session_id: string | null
          total_cents: number
        }
        Insert: {
          b2b?: Json | null
          buyer_id: string
          coupon_code?: string | null
          created_at?: string
          currency?: string
          delivery: Json
          expires_at?: string
          groups: Json
          id?: string
          pickup_in_store?: boolean
          processed_at?: string | null
          status?: string
          stripe_payment_intent?: string | null
          stripe_session_id?: string | null
          total_cents: number
        }
        Update: {
          b2b?: Json | null
          buyer_id?: string
          coupon_code?: string | null
          created_at?: string
          currency?: string
          delivery?: Json
          expires_at?: string
          groups?: Json
          id?: string
          pickup_in_store?: boolean
          processed_at?: string | null
          status?: string
          stripe_payment_intent?: string | null
          stripe_session_id?: string | null
          total_cents?: number
        }
        Relationships: []
      }
      product_list_items: {
        Row: {
          added_at: string
          list_id: string
          note: string | null
          product_id: string
          sort_order: number
        }
        Insert: {
          added_at?: string
          list_id: string
          note?: string | null
          product_id: string
          sort_order?: number
        }
        Update: {
          added_at?: string
          list_id?: string
          note?: string | null
          product_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_list_items_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "product_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_list_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_lists: {
        Row: {
          cover_emoji: string | null
          created_at: string
          description: string | null
          id: string
          is_featured: boolean
          is_public: boolean
          owner_id: string
          title: string
          updated_at: string
        }
        Insert: {
          cover_emoji?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_featured?: boolean
          is_public?: boolean
          owner_id: string
          title: string
          updated_at?: string
        }
        Update: {
          cover_emoji?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_featured?: boolean
          is_public?: boolean
          owner_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_lists_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_lists_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "product_lists_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      product_questions: {
        Row: {
          answer: string | null
          answered_at: string | null
          answered_by: string | null
          author_id: string
          created_at: string
          id: string
          is_public: boolean
          product_id: string
          question: string
        }
        Insert: {
          answer?: string | null
          answered_at?: string | null
          answered_by?: string | null
          author_id: string
          created_at?: string
          id?: string
          is_public?: boolean
          product_id: string
          question: string
        }
        Update: {
          answer?: string | null
          answered_at?: string | null
          answered_by?: string | null
          author_id?: string
          created_at?: string
          id?: string
          is_public?: boolean
          product_id?: string
          question?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_questions_answered_by_fkey"
            columns: ["answered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_questions_answered_by_fkey"
            columns: ["answered_by"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "product_questions_answered_by_fkey"
            columns: ["answered_by"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "product_questions_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_questions_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "product_questions_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "product_questions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_views: {
        Row: {
          id: number
          product_id: string
          user_id: string | null
          viewed_at: string
        }
        Insert: {
          id?: number
          product_id: string
          user_id?: string | null
          viewed_at?: string
        }
        Update: {
          id?: number
          product_id?: string
          user_id?: string | null
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_views_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "product_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      products: {
        Row: {
          attributes: Json | null
          category_id: string | null
          created_at: string | null
          description: string | null
          id: string
          images: Json | null
          name: string
          price: number
          search_tsv: unknown
          seller_id: string | null
          status: string | null
          stock: number | null
        }
        Insert: {
          attributes?: Json | null
          category_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          images?: Json | null
          name: string
          price: number
          search_tsv?: unknown
          seller_id?: string | null
          status?: string | null
          stock?: number | null
        }
        Update: {
          attributes?: Json | null
          category_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          images?: Json | null
          name?: string
          price?: number
          search_tsv?: unknown
          seller_id?: string | null
          status?: string | null
          stock?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "products_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_type: string | null
          address: string | null
          approval_requested_at: string | null
          approval_status: string | null
          approved_at: string | null
          approved_by: string | null
          billing_card_last4: string | null
          billing_iban: string | null
          business_address: string | null
          business_city: string | null
          business_form: string | null
          business_legal_name: string | null
          business_pec: string | null
          business_sdi: string | null
          business_vat_number: string | null
          business_zip: string | null
          city: string | null
          created_at: string | null
          data_accuracy_confirmed_at: string | null
          deletion_requested_at: string | null
          full_name: string | null
          id: string
          is_approved: boolean | null
          kyc_id_doc_back_url: string | null
          kyc_id_doc_front_url: string | null
          kyc_provider_check_id: string | null
          kyc_provider_checked_at: string | null
          kyc_provider_status: string | null
          kyc_selfie_url: string | null
          legal_birth_date: string | null
          legal_first_name: string | null
          legal_fiscal_code: string | null
          legal_last_name: string | null
          legal_residence_addr: string | null
          legal_residence_city: string | null
          legal_residence_zip: string | null
          phone: string | null
          privacy_accepted_at: string | null
          public_avatar_url: string | null
          public_bio: string | null
          public_handle: string | null
          public_profile_enabled: boolean
          referral_code: string | null
          referred_by: string | null
          rejection_reason: string | null
          rider_haccp_expires_on: string | null
          rider_haccp_url: string | null
          rider_insurance_expires_on: string | null
          rider_insurance_url: string | null
          rider_license_expires_on: string | null
          rider_license_url: string | null
          rider_vehicle_plate: string | null
          rider_vehicle_type: string | null
          role: string | null
          store_address: string | null
          store_description: string | null
          store_hours: Json | null
          store_lat: number | null
          store_lng: number | null
          store_logo: string | null
          store_media: Json | null
          store_name: string | null
          store_phone: string | null
          stripe_account_id: string | null
          stripe_charges_enabled: boolean | null
          stripe_details_submitted: boolean | null
          stripe_payouts_enabled: boolean | null
          subscription_renews_at: string | null
          subscription_status: string | null
          tos_accepted_at: string | null
          zip: string | null
        }
        Insert: {
          account_type?: string | null
          address?: string | null
          approval_requested_at?: string | null
          approval_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          billing_card_last4?: string | null
          billing_iban?: string | null
          business_address?: string | null
          business_city?: string | null
          business_form?: string | null
          business_legal_name?: string | null
          business_pec?: string | null
          business_sdi?: string | null
          business_vat_number?: string | null
          business_zip?: string | null
          city?: string | null
          created_at?: string | null
          data_accuracy_confirmed_at?: string | null
          deletion_requested_at?: string | null
          full_name?: string | null
          id: string
          is_approved?: boolean | null
          kyc_id_doc_back_url?: string | null
          kyc_id_doc_front_url?: string | null
          kyc_provider_check_id?: string | null
          kyc_provider_checked_at?: string | null
          kyc_provider_status?: string | null
          kyc_selfie_url?: string | null
          legal_birth_date?: string | null
          legal_first_name?: string | null
          legal_fiscal_code?: string | null
          legal_last_name?: string | null
          legal_residence_addr?: string | null
          legal_residence_city?: string | null
          legal_residence_zip?: string | null
          phone?: string | null
          privacy_accepted_at?: string | null
          public_avatar_url?: string | null
          public_bio?: string | null
          public_handle?: string | null
          public_profile_enabled?: boolean
          referral_code?: string | null
          referred_by?: string | null
          rejection_reason?: string | null
          rider_haccp_expires_on?: string | null
          rider_haccp_url?: string | null
          rider_insurance_expires_on?: string | null
          rider_insurance_url?: string | null
          rider_license_expires_on?: string | null
          rider_license_url?: string | null
          rider_vehicle_plate?: string | null
          rider_vehicle_type?: string | null
          role?: string | null
          store_address?: string | null
          store_description?: string | null
          store_hours?: Json | null
          store_lat?: number | null
          store_lng?: number | null
          store_logo?: string | null
          store_media?: Json | null
          store_name?: string | null
          store_phone?: string | null
          stripe_account_id?: string | null
          stripe_charges_enabled?: boolean | null
          stripe_details_submitted?: boolean | null
          stripe_payouts_enabled?: boolean | null
          subscription_renews_at?: string | null
          subscription_status?: string | null
          tos_accepted_at?: string | null
          zip?: string | null
        }
        Update: {
          account_type?: string | null
          address?: string | null
          approval_requested_at?: string | null
          approval_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          billing_card_last4?: string | null
          billing_iban?: string | null
          business_address?: string | null
          business_city?: string | null
          business_form?: string | null
          business_legal_name?: string | null
          business_pec?: string | null
          business_sdi?: string | null
          business_vat_number?: string | null
          business_zip?: string | null
          city?: string | null
          created_at?: string | null
          data_accuracy_confirmed_at?: string | null
          deletion_requested_at?: string | null
          full_name?: string | null
          id?: string
          is_approved?: boolean | null
          kyc_id_doc_back_url?: string | null
          kyc_id_doc_front_url?: string | null
          kyc_provider_check_id?: string | null
          kyc_provider_checked_at?: string | null
          kyc_provider_status?: string | null
          kyc_selfie_url?: string | null
          legal_birth_date?: string | null
          legal_first_name?: string | null
          legal_fiscal_code?: string | null
          legal_last_name?: string | null
          legal_residence_addr?: string | null
          legal_residence_city?: string | null
          legal_residence_zip?: string | null
          phone?: string | null
          privacy_accepted_at?: string | null
          public_avatar_url?: string | null
          public_bio?: string | null
          public_handle?: string | null
          public_profile_enabled?: boolean
          referral_code?: string | null
          referred_by?: string | null
          rejection_reason?: string | null
          rider_haccp_expires_on?: string | null
          rider_haccp_url?: string | null
          rider_insurance_expires_on?: string | null
          rider_insurance_url?: string | null
          rider_license_expires_on?: string | null
          rider_license_url?: string | null
          rider_vehicle_plate?: string | null
          rider_vehicle_type?: string | null
          role?: string | null
          store_address?: string | null
          store_description?: string | null
          store_hours?: Json | null
          store_lat?: number | null
          store_lng?: number | null
          store_logo?: string | null
          store_media?: Json | null
          store_name?: string | null
          store_phone?: string | null
          stripe_account_id?: string | null
          stripe_charges_enabled?: boolean | null
          stripe_details_submitted?: boolean | null
          stripe_payouts_enabled?: boolean | null
          subscription_renews_at?: string | null
          subscription_status?: string | null
          tos_accepted_at?: string | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "profiles_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "profiles_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "profiles_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      recently_viewed: {
        Row: {
          product_id: string
          user_id: string
          viewed_at: string
        }
        Insert: {
          product_id: string
          user_id: string
          viewed_at?: string
        }
        Update: {
          product_id?: string
          user_id?: string
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recently_viewed_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recently_viewed_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recently_viewed_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "recently_viewed_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      referrals: {
        Row: {
          bonus_awarded: boolean | null
          code: string | null
          converted_at: string | null
          created_at: string | null
          id: string
          referred_email: string | null
          referred_id: string | null
          referrer_id: string
          reward_amount: number
          rewarded: boolean | null
          rewarded_at: string | null
          status: string | null
        }
        Insert: {
          bonus_awarded?: boolean | null
          code?: string | null
          converted_at?: string | null
          created_at?: string | null
          id?: string
          referred_email?: string | null
          referred_id?: string | null
          referrer_id: string
          reward_amount?: number
          rewarded?: boolean | null
          rewarded_at?: string | null
          status?: string | null
        }
        Update: {
          bonus_awarded?: boolean | null
          code?: string | null
          converted_at?: string | null
          created_at?: string | null
          id?: string
          referred_email?: string | null
          referred_id?: string | null
          referrer_id?: string
          reward_amount?: number
          rewarded?: boolean | null
          rewarded_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referrals_referred_id_fkey"
            columns: ["referred_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referred_id_fkey"
            columns: ["referred_id"]
            isOneToOne: true
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "referrals_referred_id_fkey"
            columns: ["referred_id"]
            isOneToOne: true
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      returns: {
        Row: {
          buyer_id: string
          created_at: string | null
          decided_at: string | null
          decided_by: string | null
          decision_notes: string | null
          id: string
          notes: string | null
          order_id: string
          order_item_id: string | null
          photo_urls: Json | null
          reason: string
          refund_amount_cents: number | null
          refund_id: string | null
          refunded_at: string | null
          return_label_url: string | null
          seller_id: string
          status: string
          tracking_number: string | null
        }
        Insert: {
          buyer_id: string
          created_at?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_notes?: string | null
          id?: string
          notes?: string | null
          order_id: string
          order_item_id?: string | null
          photo_urls?: Json | null
          reason: string
          refund_amount_cents?: number | null
          refund_id?: string | null
          refunded_at?: string | null
          return_label_url?: string | null
          seller_id: string
          status?: string
          tracking_number?: string | null
        }
        Update: {
          buyer_id?: string
          created_at?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_notes?: string | null
          id?: string
          notes?: string | null
          order_id?: string
          order_item_id?: string | null
          photo_urls?: Json | null
          reason?: string
          refund_amount_cents?: number | null
          refund_id?: string | null
          refunded_at?: string | null
          return_label_url?: string | null
          seller_id?: string
          status?: string
          tracking_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "returns_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          comment: string | null
          created_at: string | null
          id: string
          photo_urls: string[] | null
          product_id: string | null
          rating: number
          user_id: string | null
          verified_purchase: boolean | null
        }
        Insert: {
          comment?: string | null
          created_at?: string | null
          id?: string
          photo_urls?: string[] | null
          product_id?: string | null
          rating: number
          user_id?: string | null
          verified_purchase?: boolean | null
        }
        Update: {
          comment?: string | null
          created_at?: string | null
          id?: string
          photo_urls?: string[] | null
          product_id?: string | null
          rating?: number
          user_id?: string | null
          verified_purchase?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      rider_reviews: {
        Row: {
          comment: string | null
          created_at: string | null
          id: string
          order_id: string
          rating: number
          rider_id: string
          user_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string | null
          id?: string
          order_id: string
          rating: number
          rider_id: string
          user_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string | null
          id?: string
          order_id?: string
          rating?: number
          rider_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rider_reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rider_reviews_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rider_reviews_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "rider_reviews_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      rider_sos_events: {
        Row: {
          handled_by: string | null
          id: string
          lat: number | null
          lng: number | null
          order_id: string | null
          resolution_note: string | null
          resolved_at: string | null
          rider_id: string
          triggered_at: string
        }
        Insert: {
          handled_by?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          order_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          rider_id: string
          triggered_at?: string
        }
        Update: {
          handled_by?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          order_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          rider_id?: string
          triggered_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rider_sos_events_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rider_sos_events_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "rider_sos_events_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "rider_sos_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rider_sos_events_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rider_sos_events_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "rider_sos_events_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      seller_promotions: {
        Row: {
          category_id: string | null
          created_at: string
          discount_percent: number
          ends_at: string
          id: string
          product_ids: string[] | null
          scope: string
          seller_id: string
          starts_at: string
          status: string
          title: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          discount_percent: number
          ends_at: string
          id?: string
          product_ids?: string[] | null
          scope: string
          seller_id: string
          starts_at?: string
          status?: string
          title: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          discount_percent?: number
          ends_at?: string
          id?: string
          product_ids?: string[] | null
          scope?: string
          seller_id?: string
          starts_at?: string
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_promotions_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_promotions_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "seller_promotions_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      seller_stories: {
        Row: {
          caption: string | null
          created_at: string
          expires_at: string
          id: string
          image_url: string
          link_url: string | null
          seller_id: string
          view_count: number
        }
        Insert: {
          caption?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          image_url: string
          link_url?: string | null
          seller_id: string
          view_count?: number
        }
        Update: {
          caption?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          image_url?: string
          link_url?: string | null
          seller_id?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "seller_stories_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_stories_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "seller_stories_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      seller_story_views: {
        Row: {
          story_id: string
          user_id: string
          viewed_at: string
        }
        Insert: {
          story_id: string
          user_id: string
          viewed_at?: string
        }
        Update: {
          story_id?: string
          user_id?: string
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_story_views_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "seller_stories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_story_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_story_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "seller_story_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      shop_of_month: {
        Row: {
          cover_image_url: string | null
          created_at: string
          discount_code: string | null
          discount_percent: number | null
          headline: string | null
          id: string
          month: string
          selected_by: string | null
          seller_id: string
          story: string | null
        }
        Insert: {
          cover_image_url?: string | null
          created_at?: string
          discount_code?: string | null
          discount_percent?: number | null
          headline?: string | null
          id?: string
          month: string
          selected_by?: string | null
          seller_id: string
          story?: string | null
        }
        Update: {
          cover_image_url?: string | null
          created_at?: string
          discount_code?: string | null
          discount_percent?: number | null
          headline?: string | null
          id?: string
          month?: string
          selected_by?: string | null
          seller_id?: string
          story?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shop_of_month_selected_by_fkey"
            columns: ["selected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_of_month_selected_by_fkey"
            columns: ["selected_by"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "shop_of_month_selected_by_fkey"
            columns: ["selected_by"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "shop_of_month_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_of_month_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "shop_of_month_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      shop_of_month_votes: {
        Row: {
          created_at: string
          id: string
          month: string
          seller_id: string
          voter_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          month: string
          seller_id: string
          voter_id: string
        }
        Update: {
          created_at?: string
          id?: string
          month?: string
          seller_id?: string
          voter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_of_month_votes_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_of_month_votes_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "shop_of_month_votes_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "shop_of_month_votes_voter_id_fkey"
            columns: ["voter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_of_month_votes_voter_id_fkey"
            columns: ["voter_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "shop_of_month_votes_voter_id_fkey"
            columns: ["voter_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      sponsored_listings: {
        Row: {
          category_slug: string | null
          clicks: number
          created_at: string
          daily_budget_cents: number
          end_date: string
          id: string
          impressions: number
          placement: string
          product_id: string | null
          seller_id: string
          spent_cents: number
          start_date: string
          status: string
        }
        Insert: {
          category_slug?: string | null
          clicks?: number
          created_at?: string
          daily_budget_cents?: number
          end_date: string
          id?: string
          impressions?: number
          placement: string
          product_id?: string | null
          seller_id: string
          spent_cents?: number
          start_date: string
          status?: string
        }
        Update: {
          category_slug?: string | null
          clicks?: number
          created_at?: string
          daily_budget_cents?: number
          end_date?: string
          id?: string
          impressions?: number
          placement?: string
          product_id?: string | null
          seller_id?: string
          spent_cents?: number
          start_date?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sponsored_listings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsored_listings_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsored_listings_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "sponsored_listings_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      store_reviews: {
        Row: {
          comment: string | null
          created_at: string | null
          id: string
          order_id: string
          rating: number
          seller_reply: string | null
          seller_reply_at: string | null
          store_id: string
          user_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string | null
          id?: string
          order_id: string
          rating: number
          seller_reply?: string | null
          seller_reply_at?: string | null
          store_id: string
          user_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string | null
          id?: string
          order_id?: string
          rating?: number
          seller_reply?: string | null
          seller_reply_at?: string | null
          store_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_reviews_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_reviews_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "store_reviews_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      stripe_event_log: {
        Row: {
          event_id: string
          processed_at: string | null
          type: string
        }
        Insert: {
          event_id: string
          processed_at?: string | null
          type: string
        }
        Update: {
          event_id?: string
          processed_at?: string | null
          type?: string
        }
        Relationships: []
      }
      subscription_orders: {
        Row: {
          created_at: string
          delivery_address: Json | null
          delivery_time: string | null
          frequency: string
          id: string
          items: Json
          last_delivery_at: string | null
          next_delivery_at: string | null
          payment_method: string
          seller_id: string
          status: string
          total_cents: number
          user_id: string
          weekday: number | null
        }
        Insert: {
          created_at?: string
          delivery_address?: Json | null
          delivery_time?: string | null
          frequency: string
          id?: string
          items: Json
          last_delivery_at?: string | null
          next_delivery_at?: string | null
          payment_method?: string
          seller_id: string
          status?: string
          total_cents: number
          user_id: string
          weekday?: number | null
        }
        Update: {
          created_at?: string
          delivery_address?: Json | null
          delivery_time?: string | null
          frequency?: string
          id?: string
          items?: Json
          last_delivery_at?: string | null
          next_delivery_at?: string | null
          payment_method?: string
          seller_id?: string
          status?: string
          total_cents?: number
          user_id?: string
          weekday?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_orders_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_orders_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "subscription_orders_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
          {
            foreignKeyName: "subscription_orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "subscription_orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      telegram_chats: {
        Row: {
          chat_id: number
          first_name: string | null
          is_bot: boolean | null
          language_code: string | null
          last_message_at: string | null
          last_name: string | null
          linked_at: string
          merchant_id: string | null
          metadata: Json | null
          role: string
          username: string | null
        }
        Insert: {
          chat_id: number
          first_name?: string | null
          is_bot?: boolean | null
          language_code?: string | null
          last_message_at?: string | null
          last_name?: string | null
          linked_at?: string
          merchant_id?: string | null
          metadata?: Json | null
          role?: string
          username?: string | null
        }
        Update: {
          chat_id?: number
          first_name?: string | null
          is_bot?: boolean | null
          language_code?: string | null
          last_message_at?: string | null
          last_name?: string | null
          linked_at?: string
          merchant_id?: string | null
          metadata?: Json | null
          role?: string
          username?: string | null
        }
        Relationships: []
      }
      uptime_checks: {
        Row: {
          checked_at: string
          error_message: string | null
          id: number
          latency_ms: number | null
          status: string
          status_code: number | null
          target_label: string | null
          target_url: string
        }
        Insert: {
          checked_at?: string
          error_message?: string | null
          id?: number
          latency_ms?: number | null
          status: string
          status_code?: number | null
          target_label?: string | null
          target_url: string
        }
        Update: {
          checked_at?: string
          error_message?: string | null
          id?: number
          latency_ms?: number | null
          status?: string
          status_code?: number | null
          target_label?: string | null
          target_url?: string
        }
        Relationships: []
      }
      user_achievements: {
        Row: {
          achievement_id: string
          unlocked_at: string
          user_id: string
        }
        Insert: {
          achievement_id: string
          unlocked_at?: string
          user_id: string
        }
        Update: {
          achievement_id?: string
          unlocked_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_achievements_achievement_id_fkey"
            columns: ["achievement_id"]
            isOneToOne: false
            referencedRelation: "achievements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_achievements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_achievements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_achievements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      user_addresses: {
        Row: {
          address: string
          city: string
          created_at: string | null
          full_name: string
          id: string
          is_default: boolean | null
          label: string
          lat: number | null
          lng: number | null
          notes: string | null
          phone: string
          user_id: string
          zip: string
        }
        Insert: {
          address: string
          city: string
          created_at?: string | null
          full_name: string
          id?: string
          is_default?: boolean | null
          label: string
          lat?: number | null
          lng?: number | null
          notes?: string | null
          phone: string
          user_id: string
          zip: string
        }
        Update: {
          address?: string
          city?: string
          created_at?: string | null
          full_name?: string
          id?: string
          is_default?: boolean | null
          label?: string
          lat?: number | null
          lng?: number | null
          notes?: string | null
          phone?: string
          user_id?: string
          zip?: string
        }
        Relationships: []
      }
      user_carts: {
        Row: {
          items: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          items?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          items?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_carts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_carts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_carts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      zone_code_uses: {
        Row: {
          code: string
          id: string
          order_id: string | null
          used_at: string
          user_id: string
        }
        Insert: {
          code: string
          id?: string
          order_id?: string | null
          used_at?: string
          user_id: string
        }
        Update: {
          code?: string
          id?: string
          order_id?: string | null
          used_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "zone_code_uses_code_fkey"
            columns: ["code"]
            isOneToOne: false
            referencedRelation: "zone_codes"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "zone_code_uses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zone_code_uses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "referral_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "zone_code_uses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "shop_of_month_leaderboard"
            referencedColumns: ["seller_id"]
          },
        ]
      }
      zone_codes: {
        Row: {
          city: string
          code: string
          created_at: string
          discount_percent: number
          expires_at: string | null
          id: string
          max_uses_per_user: number
          min_order_cents: number
          status: string
          zip: string
          zone_name: string
        }
        Insert: {
          city?: string
          code: string
          created_at?: string
          discount_percent: number
          expires_at?: string | null
          id?: string
          max_uses_per_user?: number
          min_order_cents?: number
          status?: string
          zip: string
          zone_name: string
        }
        Update: {
          city?: string
          code?: string
          created_at?: string
          discount_percent?: number
          expires_at?: string | null
          id?: string
          max_uses_per_user?: number
          min_order_cents?: number
          status?: string
          zip?: string
          zone_name?: string
        }
        Relationships: []
      }
    }
    Views: {
      referral_leaderboard: {
        Row: {
          converted_referrals: number | null
          full_name: string | null
          month: string | null
          store_name: string | null
          total_referrals: number | null
          user_id: string | null
        }
        Relationships: []
      }
      shop_of_month_leaderboard: {
        Row: {
          month: string | null
          seller_id: string | null
          store_logo: string | null
          store_name: string | null
          vote_count: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      award_loyalty_points: {
        Args: {
          p_delta: number
          p_order?: string
          p_reason: string
          p_user: string
        }
        Returns: undefined
      }
      cancel_order: { Args: { p_order_id: string }; Returns: Json }
      claim_pending_emails: {
        Args: { p_max?: number }
        Returns: {
          id: string
          template: string
          user_id: string
        }[]
      }
      generate_verification_code: { Args: never; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      list_abandoned_carts_to_recover: {
        Args: { min_hours?: number }
        Returns: {
          cart_data: Json
          cart_total: number
          email: string
          full_name: string
          last_activity: string
          user_id: string
        }[]
      }
      mark_abandoned_cart_email_sent: {
        Args: { p_user: string }
        Returns: undefined
      }
      next_invoice_number: {
        Args: { p_seller: string; p_year: number }
        Returns: string
      }
      process_expired_deletions: {
        Args: never
        Returns: {
          deleted_at: string
          user_id: string
        }[]
      }
      product_active_discount: { Args: { p_product: string }; Returns: number }
      search_products_smart: {
        Args: { lim?: number; q: string }
        Returns: {
          id: string
          images: Json
          name: string
          price: number
          rank: number
          seller_id: string
          store_name: string
        }[]
      }
      seller_reject_order: {
        Args: { p_order_id: string; p_reason?: string }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      touch_loyalty_streak: { Args: never; Returns: Json }
      track_story_view: { Args: { p_story: string }; Returns: undefined }
      unlock_achievement: {
        Args: { p_achievement: string; p_user: string }
        Returns: boolean
      }
      verify_delivery_code: {
        Args: { p_code: string; p_order_id: string }
        Returns: Json
      }
      verify_pickup_code: {
        Args: { p_code: string; p_order_id: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
