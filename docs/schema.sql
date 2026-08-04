--
-- PostgreSQL database dump
--

\restrict GNKmLA2E2rSFpfAn0kQvwGjE8IRXWRfg9HoyjI4Vqh8qHKYny0AnKtdp5VhX8E0

-- Dumped from database version 18.4 (Debian 18.4-1.pgdg13+1)
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: event_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_log (
    seq bigint NOT NULL,
    event_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    device_id uuid NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT event_log_aggregate_type_check CHECK ((aggregate_type = ANY (ARRAY['order'::text, 'shift'::text, 'ledger'::text])))
);

ALTER TABLE ONLY public.event_log FORCE ROW LEVEL SECURITY;


--
-- Name: event_log_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.event_log ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.event_log_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying(255) NOT NULL
);


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenants (
    id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.tenants FORCE ROW LEVEL SECURITY;


--
-- Name: event_log event_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_log
    ADD CONSTRAINT event_log_pkey PRIMARY KEY (seq);


--
-- Name: event_log event_log_tenant_id_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_log
    ADD CONSTRAINT event_log_tenant_id_event_id_key UNIQUE (tenant_id, event_id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: event_log_aggregate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_log_aggregate_idx ON public.event_log USING btree (tenant_id, aggregate_type, aggregate_id, seq);


--
-- Name: event_log_recorded_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_log_recorded_idx ON public.event_log USING btree (tenant_id, recorded_at, seq);


--
-- Name: event_log event_log_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_log
    ADD CONSTRAINT event_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: event_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_log ENABLE ROW LEVEL SECURITY;

--
-- Name: event_log tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.event_log USING ((tenant_id = (current_setting('app.tenant_id'::text))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.tenant_id'::text))::uuid));


--
-- Name: tenants tenant_self_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_self_read ON public.tenants FOR SELECT USING ((id = (current_setting('app.tenant_id'::text))::uuid));


--
-- Name: tenants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict GNKmLA2E2rSFpfAn0kQvwGjE8IRXWRfg9HoyjI4Vqh8qHKYny0AnKtdp5VhX8E0

