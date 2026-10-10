-- Emit the sale change before its dependent draft-completion change.
DROP TRIGGER IF EXISTS sales_complete_held_ticket ON public.sales;
DROP TRIGGER IF EXISTS zz_sales_complete_held_ticket ON public.sales;
CREATE TRIGGER zz_sales_complete_held_ticket AFTER INSERT ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.complete_held_ticket_on_sale();
